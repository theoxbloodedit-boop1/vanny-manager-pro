import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  timestamp,
  index,
  unique,
  uniqueIndex,
  primaryKey,
  foreignKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { currencyEnum, productKindEnum } from "./enums";
import { organizations } from "./org";
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("categories_org_idx").on(t.orgId),
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
    /** Cost basis stays here: internal, not customer-facing. */
    costUsdMinor: bigint("cost_usd_minor", { mode: "number" }),
    costCdfMinor: bigint("cost_cdf_minor", { mode: "number" }),
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

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductPrice = typeof productPrices.$inferSelect;
