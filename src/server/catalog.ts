/**
 * Phase 2 (ADR-0018) — CATALOG: categories + products with independent
 * USD/CDF prices (ADR-0005), low-stock thresholds, and unaccent search.
 *
 * Every function: validate input → resolve the caller's active org →
 * `authorize()` (business permission, RLS-scoped) → operate inside
 * `withTenantDb` (RLS-enforced, single transaction).
 *
 * Pricing rules (ADR-0018 D5):
 *   - create: at least ONE price (USD or CDF); both allowed, independent.
 *   - update: a price may be changed; the product may never end up with
 *     ZERO prices (deactivate it instead — D8).
 *   - no currency ever derived from the other (ADR-0005).
 */
import { and, eq, ilike, or, sql } from "drizzle-orm";
import * as z from "zod";
import { withTenantDb } from "../db/tenant";
import {
  categories,
  products,
  productPrices,
  stockMovements,
} from "../db/schema/catalog";
import { uuidv7 } from "../lib/uuid";
import { ApiError } from "./errors";
import { requireActiveOrg } from "./members";
import { authorize } from "./rbac/authorize";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const priceAmount = z
  .number()
  .int()
  .min(1)
  .max(999_999_999_99) // minor units, sanity cap
;

const priceMap = z
  .object({
    USD: priceAmount.optional(),
    CDF: priceAmount.optional(),
  })
  .refine((p) => p.USD !== undefined || p.CDF !== undefined, {
    message: "Au moins un prix est requis (USD ou CDF).",
  });

const categoryBody = z.object({
  name: z.string().min(1).max(80),
});

const productBody = z.object({
  name: z.string().min(1).max(120),
  categoryId: z.string().uuid().nullable().optional(),
  kind: z.enum(["product", "service"]).optional(),
  unit: z.string().min(1).max(20).optional(),
  sku: z.string().min(1).max(64).nullable().optional(),
  barcode: z.string().min(1).max(64).nullable().optional(),
  costUsdMinor: priceAmount.nullable().optional(),
  costCdfMinor: priceAmount.nullable().optional(),
  lowStockThreshold: z.number().int().min(0).max(1_000_000).nullable().optional(),
  prices: priceMap,
});

const productUpdateBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    categoryId: z.string().uuid().nullable().optional(),
    unit: z.string().min(1).max(20).optional(),
    sku: z.string().min(1).max(64).nullable().optional(),
    barcode: z.string().min(1).max(64).nullable().optional(),
    costUsdMinor: priceAmount.nullable().optional(),
    costCdfMinor: priceAmount.nullable().optional(),
    lowStockThreshold: z.number().int().min(0).max(1_000_000).nullable().optional(),
    isActive: z.boolean().optional(),
    /**
     * ADR-0018 D5: `number` = set that currency's price, `null` = remove it,
     * omitted = unchanged. The product may never end up with zero prices —
     * the service rejects it (deactivate the product instead).
     */
    prices: z
      .object({
        USD: priceAmount.nullable().optional(),
        CDF: priceAmount.nullable().optional(),
      })
      .optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "Rien à mettre à jour.",
  });

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(headers: Headers) {
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "products.view" });
    return db.select().from(categories).orderBy(categories.name);
  });
}

export async function createCategory(headers: Headers, raw: unknown) {
  const body = categoryBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  const id = uuidv7();
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "categories.manage" });
    try {
      await db.insert(categories).values({ id, orgId, name: body.name });
    } catch (e) {
      if (String(e).includes("categories_org_name_uq")) {
        throw new ApiError(409, "CATEGORY_EXISTS", "Cette catégorie existe déjà.");
      }
      throw e;
    }
    return { id, name: body.name };
  });
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/**
 * List active products of the org, with category name, both prices, total
 * stock (derived) and a low-stock flag. `q` = unaccent/case-insensitive
 * search on name, sku and barcode (ADR-0018 D7).
 */
export async function listProducts(headers: Headers, query: URLSearchParams) {
  const { userId, orgId } = await requireActiveOrg(headers);
  const q = (query.get("q") ?? "").trim();
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "products.view" });

    // Total stock per product (derived from the append-only ledger).
    const stockRows = await db
      .select({
        productId: stockMovements.productId,
        qty: sql<number>`coalesce(sum(${stockMovements.qtyDelta}), 0)`,
      })
      .from(stockMovements)
      .groupBy(stockMovements.productId);
    const stockByProduct = new Map(stockRows.map((r) => [r.productId, Number(r.qty)]));

    const filters = [
      query.get("includeInactive") !== "1" ? eq(products.isActive, true) : undefined,
    ];
    if (q) {
      const pattern = `%${q}%`;
      filters.push(
        or(
          ilike(sql`unaccent(${products.name})`, sql`unaccent(${pattern})`),
          ilike(products.sku, pattern),
          ilike(products.barcode, pattern),
        )!,
      );
    }

    const productRows = await db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        barcode: products.barcode,
        kind: products.kind,
        unit: products.unit,
        isActive: products.isActive,
        lowStockThreshold: products.lowStockThreshold,
        categoryId: products.categoryId,
        categoryName: sql<string>`${categories.name}`,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(...filters))
      .orderBy(products.name)
      .limit(500);

    const priceRows = await db
      .select({
        productId: productPrices.productId,
        currency: productPrices.currency,
        amount: productPrices.amountMinor,
      })
      .from(productPrices);
    const priceBy = new Map<string, { USD?: number; CDF?: number }>();
    for (const p of priceRows) {
      const key = p.productId;
      const entry = priceBy.get(key) ?? {};
      entry[p.currency] = p.amount;
      priceBy.set(key, entry);
    }

    return productRows.map((p) => {
      const prices = priceBy.get(p.id) ?? {};
      const totalStock = p.kind === "product" ? (stockByProduct.get(p.id) ?? 0) : null;
      const lowStock =
        p.kind === "product" &&
        p.lowStockThreshold !== null &&
        (totalStock ?? 0) < p.lowStockThreshold;
      return {
        ...p,
        priceUsdMinor: prices.USD ?? null,
        priceCdfMinor: prices.CDF ?? null,
        totalStock,
        lowStock,
      };
    });
  });
}

export async function createProduct(headers: Headers, raw: unknown) {
  const body = productBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  const id = uuidv7();
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "products.create" });

    if (body.categoryId) {
      const cat = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, body.categoryId))
        .limit(1);
      if (cat.length === 0) {
        throw new ApiError(400, "INVALID_CATEGORY", "Catégorie inconnue.");
      }
    }

    try {
      await db.insert(products).values({
        id,
        orgId,
        name: body.name,
        categoryId: body.categoryId ?? null,
        kind: body.kind ?? "product",
        unit: body.unit ?? "piece",
        sku: body.sku ?? null,
        barcode: body.barcode ?? null,
        costUsdMinor: body.costUsdMinor ?? null,
        costCdfMinor: body.costCdfMinor ?? null,
        lowStockThreshold: body.lowStockThreshold ?? null,
      });
    } catch (e) {
      if (String(e).includes("products_org_sku_uq")) {
        throw new ApiError(409, "SKU_EXISTS", "Cette référence SKU existe déjà.");
      }
      throw e;
    }

    // Prices: at least one (validated by zod), both independent (ADR-0005).
    await db.insert(productPrices).values([
      ...(body.prices.USD !== undefined
        ? [{ productId: id, orgId, currency: "USD" as const, amountMinor: body.prices.USD, updatedBy: userId }]
        : []),
      ...(body.prices.CDF !== undefined
        ? [{ productId: id, orgId, currency: "CDF" as const, amountMinor: body.prices.CDF, updatedBy: userId }]
        : []),
    ]);
    return { id };
  });
}

export async function updateProduct(
  headers: Headers,
  productId: string,
  raw: unknown,
) {
  const body = productUpdateBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "products.update" });

    const existing = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (existing.length === 0) {
      throw new ApiError(404, "NOT_FOUND", "Produit introuvable.");
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.categoryId !== undefined) patch.categoryId = body.categoryId;
    if (body.unit !== undefined) patch.unit = body.unit;
    if (body.sku !== undefined) patch.sku = body.sku;
    if (body.barcode !== undefined) patch.barcode = body.barcode;
    if (body.costUsdMinor !== undefined) patch.costUsdMinor = body.costUsdMinor;
    if (body.costCdfMinor !== undefined) patch.costCdfMinor = body.costCdfMinor;
    if (body.lowStockThreshold !== undefined) patch.lowStockThreshold = body.lowStockThreshold;
    if (body.isActive !== undefined) patch.isActive = body.isActive;
    try {
      await db.update(products).set(patch).where(eq(products.id, productId));
    } catch (e) {
      if (String(e).includes("products_org_sku_uq")) {
        throw new ApiError(409, "SKU_EXISTS", "Cette référence SKU existe déjà.");
      }
      throw e;
    }

    // ADR-0018 D5: prices are independent per currency (never derived from
    // the other), each editable in place; a product may never end up with
    // zero prices — deactivate it instead.
    if (body.prices) {
      for (const [currency, amount] of Object.entries(body.prices) as [
        "USD" | "CDF",
        number | null | undefined,
      ][]) {
        if (amount === undefined) continue;
        if (amount === null) {
          await db
            .delete(productPrices)
            .where(
              and(
                eq(productPrices.productId, productId),
                eq(productPrices.currency, currency),
              ),
            );
        } else {
          await db
            .insert(productPrices)
            .values({
              productId,
              orgId,
              currency,
              amountMinor: amount,
              updatedBy: userId,
            })
            .onConflictDoUpdate({
              target: [productPrices.productId, productPrices.currency],
              set: { amountMinor: amount, updatedBy: userId, updatedAt: new Date() },
            });
        }
      }
      const count = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(productPrices)
        .where(eq(productPrices.productId, productId));
      if ((count[0]!.n ?? 0) === 0) {
        throw new ApiError(
          400,
          "PRICE_REQUIRED",
          "Un produit doit toujours avoir au moins un prix (désactivez-le sinon).",
        );
      }
    }
    return { ok: true };
  });
}

/**
 * ADR-0018 D8: hard delete only if the product has NO stock movements
 * (history must stay readable); the normal path is deactivation.
 */
export async function deleteProduct(headers: Headers, productId: string) {
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "products.delete" });
    const movements = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(stockMovements)
      .where(eq(stockMovements.productId, productId))
      .limit(1);
    if ((movements[0]?.n ?? 0) > 0) {
      throw new ApiError(
        409,
        "HAS_MOVEMENTS",
        "Ce produit a un historique de stock : désactivez-le au lieu de le supprimer.",
      );
    }
    const rows = await db
      .delete(products)
      .where(eq(products.id, productId))
      .returning({ id: products.id });
    if (rows.length === 0) throw new ApiError(404, "NOT_FOUND", "Produit introuvable.");
    return { ok: true };
  });
}
