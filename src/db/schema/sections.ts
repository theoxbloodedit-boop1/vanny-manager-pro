import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { currencyEnum } from "./enums";
import { branches, organizations } from "./org";
import { users, members } from "./auth";
import { tenantIsolationPolicy } from "./rls";

/**
 * SECTIONS MANQUANTES — dépenses, fournisseurs, appareils, journal d'activité.
 * Tables tenant-scoped (org_id) via RLS (ADR-0001).
 */

/** Sorties d'argent hors caisse (loyer, achats, salaires, …). */
export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "cascade" }),
    category: text("category").notNull().default("autres"),
    label: text("label").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: currencyEnum("currency").notNull(),
    note: text("note"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("expenses_org_idx").on(t.orgId, t.createdAt.desc()),
    index("expenses_branch_idx").on(t.branchId),
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();

/** Partenaires d'achat (fournisseurs). */
export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    note: text("note"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("suppliers_org_name_uq").on(t.orgId, t.name),
    index("suppliers_org_idx").on(t.orgId),
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();

/** Appareils de vente/synchronisation (device registry — ADR-0007). */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "cascade" }),
    memberId: text("member_id").references((): AnyPgColumn => members.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    platform: text("platform").notNull().default("web"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("devices_org_idx").on(t.orgId, t.lastSeenAt.desc()),
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();

/** Journal d'activité tenant (append-only audit). */
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_log_org_idx").on(t.orgId, t.createdAt.desc()),
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();

export type Expense = typeof expenses.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type ActivityLog = typeof activityLog.$inferSelect;
