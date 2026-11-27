import { eq, and, sql, desc } from "drizzle-orm";
import * as z from "zod";
import { withTenantDb } from "../db/tenant";
import { members, users } from "../db/schema/auth";
import { branches } from "../db/schema/org";
import { stockMovements } from "../db/schema/catalog";
import { customers, sales, salesItems } from "../db/schema/sales";
import { uuidv7 } from "../lib/uuid";
import { ApiError } from "./errors";
import { requireActiveOrg } from "./members";
import { authorize } from "./rbac/authorize";

/**
 * SALES — système de vente (point de vente) pour les vendeurs et l'équipe.
 *
 * Toutes les opérations sont tenant-scoped (org_id via RLS) et contrôlées
 * par `authorize()`. Une vente :
 *   - décroît le stock (mouvement `sale`, qtyDelta négatif),
 *   - capture le numéro WhatsApp du client,
 *   - met à jour le solde crédit si le paiement est « à crédit ».
 */

const CURRENCIES = ["USD", "CDF"] as const;
const PAYMENT_METHODS = ["cash", "card", "credit", "transfer"] as const;

const saleItemBody = z.object({
  productId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  qty: z.number().int().min(1).max(9999),
  unitPriceMinor: z.number().int().min(0),
});

const saleBody = z.object({
  branchId: z.string().uuid(),
  currency: z.enum(CURRENCIES),
  paymentMethod: z.enum(PAYMENT_METHODS),
  /** Client existant (optionnel). Sinon, on peut créer le client inline. */
  customerId: z.string().uuid().optional(),
  customerName: z.string().min(1).max(120).optional(),
  /** Numéro WhatsApp du client — capturé à la vente. */
  customerPhone: z.string().max(32).optional(),
  items: z.array(saleItemBody).min(1).max(200),
});

const customerBody = z.object({
  branchId: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  phone: z.string().max(32).optional(),
  note: z.string().max(500).optional(),
});

/** List the active org's customers (with their credit balance). */
export async function listCustomers(headers: Headers, query: URLSearchParams) {
  const { orgId } = await requireActiveOrg(headers);
  const branchId = query.get("branchId");
  return withTenantDb(orgId, (db) =>
    db
      .select({
        id: customers.id,
        branchId: customers.branchId,
        name: customers.name,
        phone: customers.phone,
        note: customers.note,
        creditMinor: customers.creditMinor,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .where(branchId ? eq(customers.branchId, branchId) : undefined)
      .orderBy(customers.name),
  );
}

/** Create or update a customer (captures the WhatsApp number). */
export async function saveCustomer(headers: Headers, raw: unknown) {
  const body = customerBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);

  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "customers.manage" });
    if (body.branchId) {
      // Confirm the branch belongs to this org (RLS-scoped).
      const br = await db
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.id, body.branchId));
      if (br.length === 0) throw new ApiError(404, "NOT_FOUND", "Succursale introuvable.");
    }
    const existing = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.orgId, orgId), eq(customers.name, body.name)))
      .limit(1);
    if (existing[0]) {
      const upd: Record<string, unknown> = { updatedAt: new Date() };
      if (body.phone !== undefined) upd.phone = body.phone;
      if (body.note !== undefined) upd.note = body.note;
      if (body.branchId !== undefined) upd.branchId = body.branchId;
      await db.update(customers).set(upd).where(eq(customers.id, existing[0].id));
      return { customerId: existing[0].id, created: false };
    }
    const [created] = await db
      .insert(customers)
      .values({
        id: uuidv7(),
        orgId,
        branchId: body.branchId ?? null,
        name: body.name,
        phone: body.phone ?? null,
        note: body.note ?? null,
        creditMinor: 0,
        createdBy: userId,
      })
      .returning({ id: customers.id });
    return { customerId: created!.id, created: true };
  });
}

/** Create a sale (ticket). Decreases stock, updates the customer's credit. */
export async function createSale(headers: Headers, raw: unknown) {
  const body = saleBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);

  if (!body.customerId && !body.customerName) {
    throw new ApiError(400, "INVALID", "Un client est nécessaire pour la vente.");
  }

  const saleId = uuidv7();
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "sales.create", branchId: body.branchId });

    // Resolve the seller (member id + display name) for the receipt.
    const sellerRows = await db
      .select({ id: members.id, name: users.name })
      .from(members)
      .innerJoin(users, eq(members.userId, users.id))
      .where(and(eq(members.userId, userId), eq(members.organizationId, orgId)))
      .limit(1);
    if (sellerRows.length === 0) {
      throw new ApiError(403, "FORBIDDEN", "Vendeur non trouvé.");
    }
    const sellerMemberId = sellerRows[0]!.id;
    const sellerName = sellerRows[0]!.name;

    // Resolve or create the customer (captures the WhatsApp number).
    let customerId: string | null = body.customerId ?? null;
    if (body.customerId) {
      const rows = await db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, body.customerId));
      if (rows.length === 0) {
        throw new ApiError(404, "NOT_FOUND", "Client introuvable.");
      }
      customerId = rows[0]!.id;
    } else {
      const existing = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.orgId, orgId), eq(customers.name, body.customerName!)))
        .limit(1);
      if (existing[0]) {
        customerId = existing[0].id;
        // Update the WhatsApp number if provided at the sale.
        if (body.customerPhone) {
          await db
            .update(customers)
            .set({ phone: body.customerPhone, updatedAt: new Date() })
            .where(eq(customers.id, customerId));
        }
      } else {
        const [created] = await db
          .insert(customers)
          .values({
            id: uuidv7(),
            orgId,
            branchId: body.branchId,
            name: body.customerName!,
            phone: body.customerPhone ?? null,
            creditMinor: 0,
            createdBy: userId,
          })
          .returning({ id: customers.id });
        customerId = created!.id;
      }
    }

    // Total + line items + stock decrease, in one transaction.
    const lineTotals = body.items.map((it) => it.qty * it.unitPriceMinor);
    const totalMinor = lineTotals.reduce((a, b) => a + b, 0);

    const [saleRow] = await db
      .insert(sales)
      .values({
        id: saleId,
        orgId,
        branchId: body.branchId,
        customerId,
        sellerMemberId,
        sellerName,
        totalMinor,
        currency: body.currency,
        paymentMethod: body.paymentMethod,
        status: "completed",
      })
      .returning({ id: sales.id });

    const itemIds = body.items.map(() => uuidv7());
    await db
      .insert(salesItems)
      .values(
        body.items.map((it, i) => ({
          id: itemIds[i]!,
          orgId,
          saleId: saleRow!.id,
          productId: it.productId ?? null,
          name: it.name,
          qty: it.qty,
          unitPriceMinor: it.unitPriceMinor,
          totalMinor: it.qty * it.unitPriceMinor,
        })),
      );

    // Decrease stock: one `sale` movement per line (qtyDelta negative).
    // Only lines tied to a catalogue product affect stock (product_id is NOT NULL).
    const stockedLines = body.items.filter((it) => it.productId);
    if (stockedLines.length > 0) {
      await db
        .insert(stockMovements)
        .values(
          stockedLines.map((it) => ({
            id: uuidv7(),
            orgId,
            branchId: body.branchId,
            productId: it.productId!,
            type: "sale" as const,
            qtyDelta: -it.qty,
            reference: saleRow!.id,
            createdById: userId,
          })),
        );
    }

    // Credit sale: increase the customer's outstanding credit.
    if (body.paymentMethod === "credit" && customerId) {
      await db
        .update(customers)
        .set({ creditMinor: sql`${customers.creditMinor} + ${totalMinor}`, updatedAt: new Date() })
        .where(eq(customers.id, customerId));
    }

    return { saleId: saleRow!.id, totalMinor, customerId };
  });
}

/** Recent sales history for the active org (optionally per branch). */
export async function listSales(headers: Headers, query: URLSearchParams) {
  const { orgId } = await requireActiveOrg(headers);
  const branchId = query.get("branchId");
  const limit = Math.min(Math.max(parseInt(query.get("limit") ?? "30", 10) || 30, 1), 100);
  return withTenantDb(orgId, (db) =>
    db
      .select({
        id: sales.id,
        branchId: sales.branchId,
        customerId: sales.customerId,
        sellerName: sales.sellerName,
        totalMinor: sales.totalMinor,
        currency: sales.currency,
        paymentMethod: sales.paymentMethod,
        status: sales.status,
        createdAt: sales.createdAt,
      })
      .from(sales)
      .where(branchId ? eq(sales.branchId, branchId) : undefined)
      .orderBy(desc(sales.createdAt))
      .limit(limit),
  );
}
