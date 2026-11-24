import {
  type AnyPgColumn,
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { currencyEnum, productKindEnum } from "./enums";
import { organizations } from "./org";

/**
 * CATALOG — CTO Decision 2 (revised): selling prices live in their own
 * normalized table, so a product can be USD-only, CDF-only, or both.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("categories_org_idx").on(t.orgId),
    uniqueIndex("categories_org_name_uq").on(t.orgId, t.name),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey(), // UUIDv7, generated client-side (ADR-0003)
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
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
     * Cost basis is internal and informational, so it stays on the product row.
     * Selling prices are NOT here — see `product_prices`.
     */
    costUsdMinor: bigint("cost_usd_minor", { mode: "number" }),
    costCdfMinor: bigint("cost_cdf_minor", { mode: "number" }),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("products_org_sku_uq").on(t.orgId, t.sku),
    index("products_org_barcode_idx").on(t.orgId, t.barcode),
    index("products_org_updated_idx").on(t.orgId, t.updatedAt), // offline sync cursor
  ],
);

/**
 * Normalized price list. One row per (product, currency).
 *
 * A product with only a CDF price is valid — but a sale on a USD price list
 * that includes it MUST be rejected with PRICE_MISSING. Never convert.
 */
export const productPrices = pgTable(
  "product_prices",
  {
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    currency: currencyEnum("currency").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.currency] }),
    index("product_prices_product_idx").on(t.productId),
  ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductPrice = typeof productPrices.$inferSelect;
