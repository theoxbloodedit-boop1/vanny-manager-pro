import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  timestamp,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { desc } from "drizzle-orm";
import { currencyEnum, saleStatusEnum } from "./enums";
import { branches, organizations } from "./org";
import { users } from "./auth";
import { products } from "./catalog";
import { tenantIsolationPolicy } from "./rls";

/**
 * SALES — système de vente (point de vente) pour les vendeurs et autres
 * rôles de l'équipe. C'est le cœur mobile du produit :
 *
 *   - `customers`   un client avec son numéro WhatsApp + son solde crédit
 *   - `sales`       une vente (ticket) : client, vendeur, montant, paiement
 *   - `sales_items` les articles de la vente (snapshot du prix au moment T)
 *
 * Toutes les tables sont tenant-scoped (org_id) via RLS (ADR-0001).
 */

/**
 * A customer. `phone` is the WhatsApp number — the primary way to reach the
 * client and the field the user wants to capture at the point of sale.
 * `credit_minor` tracks the outstanding credit balance (ventes « à crédit »).
 */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references((): AnyPgColumn => branches.id),
    name: text("name").notNull(),
    /** WhatsApp number (e.g. +243 978 508 099). Primary contact channel. */
    phone: text("phone"),
    note: text("note"),
    /** Outstanding credit balance in minor units (cents / sous). */
    creditMinor: bigint("credit_minor", { mode: "number" }).notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("customers_org_idx").on(t.orgId),
    index("customers_branch_idx").on(t.branchId),
    uniqueIndex("customers_org_name_uq").on(t.orgId, t.name),
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();

/**
 * A sale (ticket). `payment_method` :
 *   - cash    argent comptant
 *   - card    carte / mobile money
 *   - credit  crédit client (solde ajouté au client)
 *   - transfer virement
 */
export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references((): AnyPgColumn => branches.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references((): AnyPgColumn => customers.id, {
      onDelete: "set null",
    }),
    /** Better Auth member id of the seller who made the sale. */
    sellerMemberId: text("seller_member_id").notNull(),
    /** Snapshot of the seller name for the receipt / history. */
    sellerName: text("seller_name"),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    currency: currencyEnum("currency").notNull(),
    paymentMethod: text("payment_method").notNull().default("cash"),
    status: saleStatusEnum("status").notNull().default("completed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sales_org_idx").on(t.orgId, desc(t.createdAt)),
    index("sales_branch_idx").on(t.branchId, desc(t.createdAt)),
    index("sales_customer_idx").on(t.customerId),
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();

/**
 * Sale line items. `name`/`unit_price` are snapshots so a later catalogue
 * change never rewrites history.
 */
export const salesItems = pgTable(
  "sales_items",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id")
      .notNull()
      .references((): AnyPgColumn => sales.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id),
    name: text("name").notNull(),
    qty: integer("qty").notNull(),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
  },
  (t) => [
    index("sales_items_sale_idx").on(t.saleId),
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();
