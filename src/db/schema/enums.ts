import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Supported currencies. CDF has no sub-unit in practice (exponent 0);
 * USD has cents (exponent 2). See `src/lib/money.ts`.
 */
export const currencyEnum = pgEnum("currency", ["USD", "CDF"]);

/** The five business sectors. Extension points are documented in SECTORS.md. */
export const businessSectorEnum = pgEnum("business_sector", [
  "boutique",
  "bar",
  "restaurant",
  "salon",
  "pharmacy",
]);

/** `service` items never touch stock. */
export const productKindEnum = pgEnum("product_kind", ["product", "service"]);

/**
 * ADR-0004/0018 — stock movement types. The enum is frozen NOW (sale/return
 * included) so Phase 3 never has to migrate an append-only ledger. `sale` and
 * `return` are written by the POS (Phase 3) only.
 */
export const stockMovementTypeEnum = pgEnum("stock_movement_type", [
  "purchase",
  "adjustment",
  "transfer_in",
  "transfer_out",
  "sale",
  "return",
]);

export const saleStatusEnum = pgEnum("sale_status", [
  "completed",
  "voided",
  "refunded",
]);

/** A cash register is a physical drawer unit, not a person and not a currency. */
export const cashSessionStatusEnum = pgEnum("cash_session_status", [
  "open",
  "closed",
]);

/* ------------------------------------------------------------------ *
 * PHASE 6.2 — PLATFORM ADMIN + BILLING (ADR-0019)
 * ------------------------------------------------------------------ */

/**
 * Subscription plan tiers (SaaS). `free` is the default a new org gets on
 * creation; `pro` / `enterprise` are the paid tiers the platform admin
 * assigns. Plans are a STATIC catalog (see src/server/platform.ts
 * PLATFORM_PLANS) — a plan code here is the source of truth, validated
 * app-side and fail-closed (unknown plan → 400, never a 500).
 */
export const subscriptionPlanEnum = pgEnum("subscription_plan", [
  "free",
  "pro",
  "enterprise",
]);

/** Subscription lifecycle status (SaaS billing). */
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "suspended",
]);

/** Billing cadence. */
export const billingIntervalEnum = pgEnum("billing_interval", [
  "monthly",
  "yearly",
]);

/**
 * Billing-event actions (append-only ledger). Every billing mutation the
 * platform admin performs is recorded here, atomically with the change.
 */
export const billingEventActionEnum = pgEnum("billing_event_action", [
  "created",
  "plan_changed",
  "status_changed",
  "seats_changed",
  "amount_changed",
  "period_renewed",
]);

/**
 * Platform-access audit actions (append-only ledger). The ROADMAP Phase-6.2
 * gate: a platform admin CANNOT read tenant data without an audit entry.
 * `org_list` = the tenant roster was read; `org_detail` = a single tenant's
 * business data was drilled into.
 */
export const platformAccessActionEnum = pgEnum("platform_access_action", [
  "org_list",
  "org_detail",
]);
