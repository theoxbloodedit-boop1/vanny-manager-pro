import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";
import { users } from "./auth";
import { tenantIsolationPolicy } from "./rls";

/**
 * COFFRE-FORT (ADR-0022) — vault per organization.
 *
 * The vault holds a running balance. Obligations (factures, loyer, impôt) are
 * payables the business must settle; deposits (caisse, transferts) feed the
 * vault; payments are applied to an obligation and reduce its remaining
 * amount. Everyone pays gradually — no stress at the end of the month.
 */

export const vaultObligations = pgTable(
  "vault_obligations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind").notNull().default("expense"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    paidMinor: bigint("paid_minor", { mode: "number" }).notNull().default(0),
    status: text("status").notNull().default("open"),
    note: text("note"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("vault_obligations_org_idx").on(t.orgId, t.status, t.dueAt),
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();

export const vaultEntries = pgTable(
  "vault_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    obligationId: uuid("obligation_id").references(
      (): AnyPgColumn => vaultObligations.id,
      { onDelete: "set null" },
    ),
    note: text("note"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("vault_entries_org_idx").on(t.orgId, t.createdAt),
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();
