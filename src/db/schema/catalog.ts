import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  integer,
  timestamp,
  index,
  unique,
  uniqueIndex,
  primaryKey,
  foreignKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { currencyEnum, productKindEnum, stockMovementTypeEnum } from "./enums";
import { branches, organizations } from "./org";
import { tenantIsolationPolicy } from "./rls";

/**
 * CATALOG — CTO Decision 2 (revised): selling prices live in their own
 * normalized table, so a product can be USD-only, CDF-only, or both.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id),
    name: text("name").notNull(),
    /**
     * ADR-0020 — advanced catalogue: explicit display order (lower = first).
     * NULL/0 = unordered (shown by createdAt).
     */
    sortOrder: integer("sort_order").notNull().default(0),
    /** Optional lucide icon name for the category (advanced catalogue). */
    icon: text("icon"),
    /** Optional accent color (#RRGGBB) for the category chip. */
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("categories_org_idx").on(t.orgId),
    index("categories_org_sort_idx").on(t.orgId, t.sortOrder),
    uniqueIndex("categories_org_name_uq").on(t.orgId, t.name),
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey(), // UUIDv7, generated client-side (ADR-0003)
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references((): AnyPgColumn => categories.id),
    name: text("name").notNull(),
    sku: text("sku"),
    barcode: text("barcode"),
    kind: productKindEnum("kind").notNull().default("product"),
    unit: text("unit").notNull().default("piece"),
    /** Pharmacy extension point — reserved, not implemented in v1. */
    trackExpiry: boolean("track_expiry").notNull().default(false),
    batchRequired: boolean("batch_required").notNull().default(false),
    /**
     * ADR-0020 — advanced catalogue: tax-exempt flag (pharmacy/agro). When
     * true the product is not subject to sales tax (modeled at the POS layer
     * in Phase 3). Default false.
     */
    taxFree: boolean("tax_free").notNull().default(false),
    /** Cost basis stays here: internal, not customer-facing. */
    costUsdMinor: bigint("cost_usd_minor", { mode: "number" }),
    costCdfMinor: bigint("cost_cdf_minor", { mode: "number" }),
    /**
     * ADR-0018 D6 — low-stock alert threshold (units, per branch). NULL = no
     * alert. The "low" state is DERIVED (branch_stock.qty < threshold), never
     * stored.
     */
    lowStockThreshold: integer("low_stock_threshold"),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("products_org_sku_uq").on(t.orgId, t.sku),
    index("products_org_barcode_idx").on(t.orgId, t.barcode),
    index("products_org_updated_idx").on(t.orgId, t.updatedAt), // offline sync cursor
    /**
     * Required so `product_prices` can carry a composite FK down to its tenant.
     * A UNIQUE CONSTRAINT (not a unique index) on purpose: drizzle-kit emits
     * FK statements before index statements, so an FK referencing an index
     * created later fails on a fresh database. Constraints live inside the
     * CREATE TABLE and therefore exist first. (Caught by real-DB tests,
     * tests/integration/isolation.test.ts.)
     */
    unique("products_id_org_uq").on(t.id, t.orgId),
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();

/**
 * Normalized price list. One row per (product, currency).
 *
 * `org_id` is denormalised so RLS can isolate price rows directly. The composite
 * foreign key `(product_id, org_id) → products(id, org_id)` makes it impossible
 * for a price row to claim a tenant different from its product's.
 */
export const productPrices = pgTable(
  "product_prices",
  {
    productId: uuid("product_id").notNull(),
    orgId: uuid("org_id").notNull(),
    currency: currencyEnum("currency").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.currency] }),
    index("product_prices_product_idx").on(t.productId),
    index("product_prices_org_idx").on(t.orgId),
    foreignKey({
      columns: [t.productId, t.orgId],
      foreignColumns: [products.id, products.orgId],
      name: "product_prices_product_org_fk",
    }).onDelete("cascade"),
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();

/**
 * ADR-0004 / ADR-0018 — APPEND-ONLY stock ledger.
 *
 * Never UPDATEd or DELETEd: not by application code (enforced by a code-grep
 * test, ADR-0018 §2) and not even by the schema owner (BEFORE UPDATE OR
 * DELETE trigger → exception, same style as manual_approvals, ADR-0014).
 * Corrections are new documents: a stock error = a new `adjustment` row with
 * a mandatory reason.
 *
 * Invariant (T3): branch_stock(branch, product) ==
 *   Σ stock_movements(branch, product).qty_delta — branch_stock is a VIEW
 *   (ADR-0018 D2), so the invariant holds by construction and is still
 *   proven by an independent recomputation in tests.
 *
 * NOTE (ADR-0018 D2): the `branch_stock` view is created in the migration SQL
 * (not modeled by drizzle-kit) WITH (security_invoker = true) — mandatory, so
 * the caller's RLS policy filters its rows (an owner-owned view would bypass
 * RLS and leak every tenant's stock).
 *
 * `counterparty_branch_id` is set for transfers only: the destination on a
 * `transfer_out` row, the origin on the matching `transfer_in` row.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey(), // UUIDv7, generated client-side (ADR-0003)
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    /** Set on transfers only (destination on transfer_out, origin on transfer_in). */
    counterpartyBranchId: uuid("counterparty_branch_id"),
    type: stockMovementTypeEnum("type").notNull(),
    /** Signed units: purchase/transfer_in/return > 0, transfer_out/sale < 0, adjustment ±. */
    qtyDelta: integer("qty_delta").notNull(),
    /** Optional business reference ("Achat réf. #12", sale id in Phase 3). */
    reference: text("reference"),
    /** Mandatory in the service layer for `adjustment` (audit teaching, ADR-0004). */
    reason: text("reason"),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stock_movements_org_branch_product_idx").on(t.orgId, t.branchId, t.productId),
    index("stock_movements_org_product_idx").on(t.orgId, t.productId),
    index("stock_movements_org_created_idx").on(t.orgId, t.createdAt),
    foreignKey({
      columns: [t.productId, t.orgId],
      foreignColumns: [products.id, products.orgId],
      name: "stock_movements_product_org_fk",
    }).onDelete("restrict"),
    // NOTE: the CHECK ("qty_delta" <> 0) constraint is added manually in the
    // migration SQL (0007) — drizzle-kit 0.31 + drizzle-orm 0.45 cannot
    // serialize `check()` here (sql-tag interop). Kept in sync by review.
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductPrice = typeof productPrices.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
