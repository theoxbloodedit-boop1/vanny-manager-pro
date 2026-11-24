import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cashSessionStatusEnum, currencyEnum } from "./enums";
import { branches, organizations } from "./org";
import { tenantIsolationPolicy } from "./rls";

/**
 * CASH — CTO Decision 3 (revised).
 *
 * Four distinct concepts that must never be conflated:
 *
 *   physical register  →  `cash_registers`   a drawer / till unit (many per branch)
 *   cashier            →  a `member`          a person, never a register
 *   currency           →  `currency` column   USD and CDF are separate balances
 *   cash session       →  `cash_sessions`     one cashier's shift on one register,
 *                                             in ONE currency
 *
 * At most ONE open session exists per (register, currency), enforced by a
 * partial unique index at the database level.
 */
export const cashRegisters = pgTable(
  "cash_registers",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    /** Human label, e.g. "Caisse 1", "Bar drawer". */
    name: text("name").notNull(),
    /** Short code printed on receipts, e.g. "C1". */
    code: text("code").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cash_registers_org_code_uq").on(t.orgId, t.code),
    index("cash_registers_branch_idx").on(t.branchId),
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();

export const cashSessions = pgTable(
  "cash_sessions",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    registerId: uuid("register_id")
      .notNull()
      .references(() => cashRegisters.id),
    currency: currencyEnum("currency").notNull(),
    /** Better Auth member id of the cashier working this session. */
    cashierMemberId: text("cashier_member_id").notNull(),
    status: cashSessionStatusEnum("status").notNull().default("open"),

    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),

    openingFloatMinor: bigint("opening_float_minor", { mode: "number" }).notNull().default(0),
    /** Computed on close: openingFloat + takings − refunds. Never typed by hand. */
    expectedMinor: bigint("expected_minor", { mode: "number" }),
    countedMinor: bigint("counted_minor", { mode: "number" }),
    /** Computed on close: counted − expected. */
    varianceMinor: bigint("variance_minor", { mode: "number" }),

    /**
     * Handover: when cashier B takes over from cashier A on the same
     * register + currency, A's session closes and B's opens with this set.
     * The chain is auditable: each session points at its predecessor.
     */
    handoverFromSessionId: uuid("handover_from_session_id").references(
      (): AnyPgColumn => cashSessions.id,
    ),
    note: text("note"),
  },
  (t) => [
    /**
     * THE core invariant: at most one OPEN session per register per currency.
     * A partial unique index — Postgres rejects a second open session outright.
     */
    uniqueIndex("cash_session_open_uq")
      .on(t.registerId, t.currency)
      .where(sql`${t.status} = 'open'`),
    index("cash_session_branch_open_idx").on(t.branchId, t.openedAt),
    index("cash_session_register_idx").on(t.registerId),
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();

export type CashRegister = typeof cashRegisters.$inferSelect;
export type CashSession = typeof cashSessions.$inferSelect;
