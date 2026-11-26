/**
 * Phase 2 (ADR-0018) — INVENTORY: the append-only stock ledger and its
 * derived quantities.
 *
 * Invariants enforced here:
 *  - D1: this module NEVER updates or deletes a stock movement. Corrections
 *    are new `adjustment` rows (a DB trigger would reject a mutation anyway).
 *  - D3: a transfer is ONE transaction with TWO writes per item. Any failure
 *    (insufficient stock, FK, constraint) rolls back the whole transfer —
 *    both branches move together or neither does.
 *  - D4: a movement that would make a branch's stock negative is rejected
 *    with 409 INSUFFICIENT_STOCK; `kind = service` products never move stock
 *    (409 SERVICE_NO_STOCK).
 *
 * Concurrency (ADR-0018 §4): the stock check and the writes happen in the
 * same transaction; a transaction-level advisory lock per (org, product)
 * serializes concurrent transfers/adjustments of the same product so the
 * check-then-write cannot interleave.
 */
import { desc, eq, sql } from "drizzle-orm";
import * as z from "zod";
import { withTenantDb, type TenantDb } from "../db/tenant";
import { branches } from "../db/schema/org";
import { products, stockMovements } from "../db/schema/catalog";
import { uuidv7 } from "../lib/uuid";
import { ApiError } from "./errors";
import { requireActiveOrg } from "./members";
import { authorize } from "./rbac/authorize";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const movementBody = z
  .object({
    type: z.enum(["purchase", "adjustment"]),
    branchId: z.string().uuid(),
    productId: z.string().uuid(),
    /** Units moved (positive). The sign is derived from the type. */
    qty: z.number().int().min(1).max(1_000_000),
    /** For adjustment: which way the stock moves. */
    direction: z.enum(["in", "out"]).optional(),
    reference: z.string().min(1).max(120).optional(),
    reason: z.string().min(3).max(500).optional(),
  })
  .refine((b) => b.type !== "adjustment" || b.reason !== undefined, {
    message: "Un motif est obligatoire pour un ajustement (ADR-0004).",
    path: ["reason"],
  })
  .refine((b) => b.type !== "adjustment" || b.direction !== undefined, {
    message: "Une direction (in/out) est obligatoire pour un ajustement.",
    path: ["direction"],
  });

const transferItem = z
  .object({
    productId: z.string().uuid(),
    qty: z.number().int().min(1).max(1_000_000),
  })
  .strict();

export const transferBody = z
  .object({
    fromBranchId: z.string().uuid(),
    toBranchId: z.string().uuid(),
    items: z.array(transferItem).min(1).max(100),
    reference: z.string().min(1).max(120).optional(),
  })
  .strict()
  .refine((b) => b.fromBranchId !== b.toBranchId, {
    message: "Un transfert part et arrive en deux succursales distinctes.",
    path: ["toBranchId"],
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Current quantity of a product at a branch, recomputed from the ledger.
 * Same definition as the `branch_stock` view (ADR-0018 D2).
 *
 * RLS note: `stock_movements` rows are filtered by the tenant policy, so a
 * caller can never read another org's stock.
 */
async function currentQty(
  db: TenantDb,
  orgId: string,
  branchId: string,
  productId: string,
): Promise<number> {
  // org_id filter is defense-in-depth on top of the tenant RLS scope.
  const { rows } = await db.execute(sql`
      select coalesce(sum(sm.qty_delta), 0)::int as qty
      from stock_movements sm
      where sm.org_id = ${orgId}
        and sm.branch_id = ${branchId}
        and sm.product_id = ${productId}
    `);
  return Number((rows[0] as { qty?: number } | undefined)?.qty ?? 0);
}

/**
 * Serialize check-then-write per (org, product) across concurrent
 * transactions. Held until COMMIT/ROLLBACK of the surrounding
 * `withTenantDb` transaction (ADR-0018 §4, risk 1).
 */
async function lockProduct(db: TenantDb, orgId: string, productId: string): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext('vanny-stock:' || ${orgId} || ':' || ${productId}))`,
  );
}

/** The branch must exist in this org (RLS makes it fail-closed). */
async function assertBranch(db: TenantDb, branchId: string): Promise<void> {
  const rows = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  if (rows.length === 0) throw new ApiError(404, "NOT_FOUND", "Succursale introuvable.");
}

/** A `kind = service` product never moves stock (ADR-0018 D4). */
async function assertIsGoods(db: TenantDb, productId: string): Promise<void> {
  const [product] = await db
    .select({ kind: products.kind })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product) throw new ApiError(404, "NOT_FOUND", "Produit introuvable.");
  if (product.kind === "service") {
    throw new ApiError(
      409,
      "SERVICE_NO_STOCK",
      "Les services ne touchent pas le stock — enregistrez la vente sans quantité.",
    );
  }
}

// ---------------------------------------------------------------------------
// Read: stock positions & movements
// ---------------------------------------------------------------------------

/**
 * Stock position per branch for every product that has moved, with the
 * low-stock flag (ADR-0018 D6: derived from `low_stock_threshold`, never
 * stored). Optional `?branchId=` filter.
 */
export async function listStock(headers: Headers, query: URLSearchParams) {
  const { userId, orgId } = await requireActiveOrg(headers);
  const branchId = query.get("branchId") ?? undefined;
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "inventory.view" });

    const branchRows = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches);
    const branchName = new Map(branchRows.map((b) => [b.id, b.name]));

    type Position = { branch_id: string; product_id: string; qty: number };
    const { rows } = await db.execute(
      branchId
        ? sql`
            select m.branch_id::text as branch_id,
                   m.product_id::text as product_id,
                   sum(m.qty_delta)::int as qty
            from stock_movements m
            where m.org_id = ${orgId}
              and m.branch_id = ${branchId}
            group by m.branch_id, m.product_id
          `
        : sql`
            select m.branch_id::text as branch_id,
                   m.product_id::text as product_id,
                   sum(m.qty_delta)::int as qty
            from stock_movements m
            where m.org_id = ${orgId}
            group by m.branch_id, m.product_id
          `,
    );
    const pos = rows as Position[];

    const productIds = [...new Set(pos.map((p) => p.product_id))];
    const productRows =
      productIds.length > 0
        ? await db
            .select({
              id: products.id,
              name: products.name,
              sku: products.sku,
              unit: products.unit,
              threshold: products.lowStockThreshold,
            })
            .from(products)
            .where(
              sql`${products.id} in (${sql.join(
                productIds.map((id) => sql`${id}`),
                sql`, `,
              )})`,
            )
        : [];
    const byProduct = new Map(productRows.map((p) => [p.id, p]));

    return pos
      .map((p) => {
        const product = byProduct.get(p.product_id);
        if (!product) return null;
        const lowStock = product.threshold !== null && p.qty < product.threshold;
        return {
          branchId: p.branch_id,
          branchName: branchName.get(p.branch_id) ?? "—",
          productId: p.product_id,
          productName: product.name,
          sku: product.sku,
          unit: product.unit,
          qty: p.qty,
          lowStockThreshold: product.threshold,
          lowStock,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) =>
        a.branchName === b.branchName
          ? a.productName.localeCompare(b.productName, "fr")
          : a.branchName.localeCompare(b.branchName, "fr"),
      );
  });
}

/** Recent ledger entries (newest first). Read-only by design — no edits. */
export async function listMovements(headers: Headers, query: URLSearchParams) {
  const { userId, orgId } = await requireActiveOrg(headers);
  const limit = Math.min(Number(query.get("limit") ?? 50) || 50, 200);
  const branchId = query.get("branchId") ?? undefined;
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "inventory.view" });
    const rows = await db
      .select({
        id: stockMovements.id,
        type: stockMovements.type,
        qtyDelta: stockMovements.qtyDelta,
        branchId: stockMovements.branchId,
        counterpartyBranchId: stockMovements.counterpartyBranchId,
        reference: stockMovements.reference,
        reason: stockMovements.reason,
        createdAt: stockMovements.createdAt,
        branchName: sql<string>`${branches.name}`,
        productName: sql<string>`${products.name}`,
        sku: sql<string | null>`${products.sku}`,
      })
      .from(stockMovements)
      .leftJoin(branches, eq(stockMovements.branchId, branches.id))
      .leftJoin(products, eq(stockMovements.productId, products.id))
      .where(branchId ? eq(stockMovements.branchId, branchId) : undefined)
      .orderBy(desc(stockMovements.createdAt))
      .limit(limit);
    return rows;
  });
}

// ---------------------------------------------------------------------------
// Write: purchases & adjustments (single-row documents)
// ---------------------------------------------------------------------------

export async function recordMovement(headers: Headers, raw: unknown) {
  const body = movementBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  const id = uuidv7();
  const delta =
    body.type === "purchase"
      ? body.qty
      : body.direction === "in"
        ? body.qty
        : -body.qty;

  return withTenantDb(orgId, async (db) => {
    await authorize(db, {
      userId,
      permission: "inventory.adjust",
      branchId: body.branchId,
    });
    await assertBranch(db, body.branchId);
    await assertIsGoods(db, body.productId);
    await lockProduct(db, orgId, body.productId);

    const before = await currentQty(db, orgId, body.branchId, body.productId);
    const after = before + delta;
    if (after < 0) {
      throw new ApiError(
        409,
        "INSUFFICIENT_STOCK",
        `Stock insuffisant : ${before} en stock, sortie de ${Math.abs(delta)} demandée.`,
      );
    }

    const [row] = await db
      .insert(stockMovements)
      .values({
        id,
        orgId,
        branchId: body.branchId,
        productId: body.productId,
        type: body.type,
        qtyDelta: delta,
        reference: body.reference ?? null,
        reason: body.reason ?? null,
        createdById: userId,
      })
      .returning({ id: stockMovements.id });
    if (!row) throw new ApiError(500, "INTERNAL", "Écriture du mouvement impossible.");
    return { id: row.id, qtyDelta: delta };
  });
}

// ---------------------------------------------------------------------------
// Write: atomic transfer (ADR-0018 D3)
// ---------------------------------------------------------------------------

/**
 * ONE transaction, TWO writes per item (`transfer_out` at the origin,
 * `transfer_in` at the destination, linked by the same reference). Any
 * failure anywhere rolls back the whole transfer — there is no intermediate
 * state between the two branches.
 */
export async function transferStock(headers: Headers, raw: unknown) {
  const body = transferBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  const transferRef = body.reference ?? `TRF-${uuidv7()}`;

  return withTenantDb(orgId, async (db) => {
    await authorize(db, {
      userId,
      permission: "inventory.transfer",
      branchId: body.fromBranchId,
    });
    await authorize(db, {
      userId,
      permission: "inventory.transfer",
      branchId: body.toBranchId,
    });

    // Validate branches and products up front (before taking any lock).
    await assertBranch(db, body.fromBranchId);
    await assertBranch(db, body.toBranchId);
    const seen = new Set<string>();
    for (const item of body.items) {
      if (seen.has(item.productId)) {
        throw new ApiError(
          400,
          "DUPLICATE_ITEM",
          "Un produit apparaît deux fois dans le transfert.",
        );
      }
      seen.add(item.productId);
      await assertIsGoods(db, item.productId);
    }

    // Lock each product before reading its stock.
    for (const item of body.items) {
      await lockProduct(db, orgId, item.productId);
    }

    // Stock at the origin must cover every item.
    for (const item of body.items) {
      const avail = await currentQty(db, orgId, body.fromBranchId, item.productId);
      if (avail < item.qty) {
        throw new ApiError(
          409,
          "INSUFFICIENT_STOCK",
          `Stock insuffisant à la succursale d'origine : ${avail} disponibles, ${item.qty} demandés.`,
        );
      }
    }

    // Both branches move together: one pair of rows per item.
    const written: string[] = [];
    for (const item of body.items) {
      const outId = uuidv7();
      const inId = uuidv7();
      await db.insert(stockMovements).values({
        id: outId,
        orgId,
        branchId: body.fromBranchId,
        productId: item.productId,
        counterpartyBranchId: body.toBranchId,
        type: "transfer_out",
        qtyDelta: -item.qty,
        reference: transferRef,
        reason: null,
        createdById: userId,
      });
      await db.insert(stockMovements).values({
        id: inId,
        orgId,
        branchId: body.toBranchId,
        productId: item.productId,
        counterpartyBranchId: body.fromBranchId,
        type: "transfer_in",
        qtyDelta: item.qty,
        reference: transferRef,
        reason: null,
        createdById: userId,
      });
      written.push(outId, inId);
    }
    return { reference: transferRef, movements: written };
  });
}
