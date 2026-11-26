import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  billingEventActionEnum,
  billingIntervalEnum,
  platformAccessActionEnum,
  subscriptionPlanEnum,
  subscriptionStatusEnum,
} from "./enums";
import { organizations } from "./org";

/**
 * PHASE 6.2 — PLATFORM ADMIN + BILLING (ADR-0019).
 *
 * These are PLATFORM tables, NOT tenant tables: a subscription and its
 * billing history belong to the platform, not to any one tenant. They are
 * therefore NOT RLS-scoped and NOT read through `withTenantDb()`. They are
 * reached only through the operator-gated platform service
 * (`src/server/platform.ts`), which enforces that the caller is an
 * authorized platform operator (fail-closed allowlist) and writes an
 * append-only audit row for every cross-tenant read and every mutation.
 *
 * Billing here is the ADMIN SURFACE: plan/status/seats/amount/period
 * management with a full audited ledger. Payment-provider integration
 * (Stripe/Flutterwave etc.) is a separate concern (ADR-0019 §out-of-scope)
 * and is not modeled here — `amount_minor` + `currency` record what the
 * plan costs; capture/settlement is deliberately out of scope for v1.
 */

/**
 * One subscription row per organization. Created lazily by the platform
 * service (the org's `free` plan is materialized on first admin touch, or
 * on org creation — see src/server/platform.ts). `org_id` is unique: an
 * organization has at most one active subscription record.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    plan: subscriptionPlanEnum("plan").notNull().default("free"),
    status: subscriptionStatusEnum("status").notNull().default("trialing"),
    interval: billingIntervalEnum("interval").notNull().default("monthly"),
    seats: integer("seats").notNull().default(1),
    /** Price in minor units, in the org's billing currency. 0 = free plan. */
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("subscriptions_org_uq").on(t.orgId),
    index("subscriptions_plan_idx").on(t.plan),
    index("subscriptions_status_idx").on(t.status),
  ],
);

/**
 * APPEND-ONLY billing ledger. Every billing mutation (create, plan change,
 * status change, seats/amount change, period renewal) is recorded here,
 * atomically with the `subscriptions` change. UPDATE/DELETE are forbidden at
 * the database level (trigger, same style as ADR-0014/0018). Written ONLY by
 * the platform service.
 */
export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").primaryKey(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    action: billingEventActionEnum("action").notNull(),
    /** Operator (session user id) who performed the change. */
    operatorId: text("operator_id").notNull(),
    /** Mandatory human-readable reason, for the audit trail. */
    reason: text("reason").notNull(),
    /** Plan/status/seats BEFORE the change (for the audit diff). */
    previousPlan: text("previous_plan"),
    previousStatus: text("previous_status"),
    previousSeats: integer("previous_seats"),
    /** Plan/status/seats AFTER the change. */
    newPlan: text("new_plan"),
    newStatus: text("new_status"),
    newSeats: integer("new_seats"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("billing_events_subscription_idx").on(t.subscriptionId),
    index("billing_events_org_idx").on(t.orgId),
    index("billing_events_created_idx").on(t.createdAt),
  ],
);

/**
 * APPEND-ONLY platform-access audit ledger. The Phase-6.2 security gate:
 * a platform admin CANNOT read tenant data without an audit entry. Every
 * cross-tenant read (the org roster, or a single org's business summary)
 * writes one row here, recording WHO (operator id), WHAT (action + org),
 * and WHEN. UPDATE/DELETE forbidden at the DB level (trigger).
 */
export const platformAccessLog = pgTable(
  "platform_access_log",
  {
    id: uuid("id").primaryKey(),
    operatorId: text("operator_id").notNull(),
    action: platformAccessActionEnum("action").notNull(),
    /** The organization accessed (null only for platform-wide reads). */
    orgId: uuid("org_id"),
    /** Optional free-form detail (e.g. what was drilled into). */
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("platform_access_log_operator_idx").on(t.operatorId),
    index("platform_access_log_org_idx").on(t.orgId),
    index("platform_access_log_created_idx").on(t.createdAt),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type BillingEvent = typeof billingEvents.$inferSelect;
export type PlatformAccessEntry = typeof platformAccessLog.$inferSelect;
