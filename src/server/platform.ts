/**
 * PHASE 6.2 — PLATFORM ADMIN SURFACE + BILLING (ADR-0019) — service layer.
 *
 * This is the "SaaS admin dashboard" service. It is reachable ONLY through
 * operator-gated API routes. Every function here:
 *
 *   1. REQUIRES an authenticated session whose email is in the
 *      `PLATFORM_OPERATOR_EMAILS` allowlist (fail-closed) — reuses the
 *      operator gate from ADR-0016 (`requireOperator`).
 *   2. READS TENANT DATA CROSS-TENANT via `getDb()` (the schema-owner role),
 *      NOT through `withTenantDb()`. That is the whole point of a platform
 *      admin — and it is why the ROADMAP Phase-6.2 gate exists.
 *   3. WRITES AN AUDIT ENTRY for every cross-tenant read (`platform_access_log`,
 *      append-only) and every billing mutation (`billing_events`, append-only),
 *      atomically with the change. A platform admin CANNOT read tenant data
 *      without leaving a trace. This is enforced in code (the service always
 *      writes the ledger) AND at the DB level (the ledger tables are
 *      append-only via triggers — ADR-0019).
 *
 * Billing scope (ADR-0019): this is the ADMIN SURFACE — plan/status/seats/
 * amount/period management with a full audited ledger. Payment-provider
 * integration (capture/settlement) is deliberately OUT of scope for v1; the
 * `amount_minor` records what the plan costs, nothing is charged here.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import * as z from "zod";
import { getAuth } from "../auth";
import { getAuthDb } from "../auth/db";
import {
  billingEvents,
  platformAccessLog,
  subscriptions,
} from "../db/schema/platform";
import { branches, organizations } from "../db/schema/org";
import { members, users } from "../db/schema/auth";
import { products } from "../db/schema/catalog";
import { uuidv7 } from "../lib/uuid";
import { ApiError } from "./errors";
import { isAuthorizedPlatformOperator } from "./operator-token";

/* ------------------------------------------------------------------ *
 * Static plan catalog (the source of truth for plan codes + pricing)
 * ------------------------------------------------------------------ */

export interface PlanDef {
  code: "free" | "pro" | "enterprise";
  label: string;
  /** Default price in minor units (billing currency). */
  amountMinor: number;
  /** Default seat count for the plan. */
  seats: number;
  /** Whether the plan is billable (free = no charge). */
  billable: boolean;
}

/**
 * PLATFORM_PLANS — a STATIC catalog, validated app-side and fail-closed.
 * An unknown plan code is rejected with 400, never a 500. Prices are in
 * minor units of the org's billing currency (USD by default).
 */
export const PLATFORM_PLANS: Record<string, PlanDef> = {
  free: { code: "free", label: "Gratuit", amountMinor: 0, seats: 1, billable: false },
  pro: { code: "pro", label: "Pro", amountMinor: 2500, seats: 5, billable: true },
  enterprise: {
    code: "enterprise",
    label: "Entreprise",
    amountMinor: 10000,
    seats: 20,
    billable: true,
  },
};

export function getPlanDef(code: string): PlanDef | undefined {
  return PLATFORM_PLANS[code];
}

/* ------------------------------------------------------------------ *
 * Operator gate (ADR-0016) — re-implemented locally so this module is
 * self-contained and does not import the phone-auth service (which pulls in
 * sign-up/sign-in helpers we do not need here).
 * ------------------------------------------------------------------ */

/**
 * Authenticated session + authorized platform operator (fail-closed allowlist).
 * The session IS the identity.
 */
export async function requireOperator(
  headers: Headers,
): Promise<{ operatorId: string; operatorEmail: string }> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers });
  const user = session?.user;
  if (!user?.id || !user?.email) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentification requise");
  }
  if (!isAuthorizedPlatformOperator(user.email)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Cette action est réservée aux opérateurs de la plateforme.",
    );
  }
  // ADR-0033: the operator allowlist alone is not enough — the email must also
  // be verified. Otherwise anyone who registers with an operator's email before
  // the operator does would inherit cross-tenant platform access.
  if (!user.emailVerified) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Email de l'opérateur non vérifié — vérification requise pour la plateforme.",
    );
  }
  return { operatorId: user.id, operatorEmail: user.email };
}

/* ------------------------------------------------------------------ *
 * Cross-tenant access audit (the Phase-6.2 security gate)
 * ------------------------------------------------------------------ */

/**
 * Write an append-only `platform_access_log` row. Called by EVERY cross-tenant
 * read in this service. Never throws the read — a failed audit write is a
 * serious error and SHOULD surface (fail-closed: if we cannot record the read,
 * we must not serve it).
 */
async function auditAccess(
  operatorId: string,
  action: "org_list" | "org_detail",
  orgId: string | null,
  detail?: string,
): Promise<void> {
  const db = getAuthDb();
  await db.insert(platformAccessLog).values({
    id: uuidv7(),
    operatorId,
    action,
    orgId,
    detail,
    createdAt: new Date(),
  });
}

/* ------------------------------------------------------------------ *
 * Organization roster (cross-tenant, audited)
 * ------------------------------------------------------------------ */

export interface OrgRow {
  orgId: string;
  name: string;
  slug: string;
  businessSector: string;
  baseCurrency: string;
  status: string;
  createdAt: string;
  memberCount: number;
  branchCount: number;
  productCount: number;
  subscription: {
    plan: string;
    status: string;
    interval: string;
    seats: number;
    amountMinor: number;
    currency: string;
    currentPeriodEnd: string;
  } | null;
}

/**
 * List every organization with a business summary + subscription. This is a
 * CROSS-TENANT read → writes an `org_list` audit entry (one per call, scoped
 * to the operator). Operator-gated.
 */
export async function listOrganizations(
  headers: Headers,
): Promise<{ organizations: OrgRow[]; total: number }> {
  const { operatorId } = await requireOperator(headers);
  const db = getAuthDb();

  // Audit BEFORE serving (fail-closed: if the audit write fails, the read
  // must not proceed).
  await auditAccess(operatorId, "org_list", null, "roster");

  const orgs = await db
    .select({
      orgId: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      businessSector: organizations.businessSector,
      baseCurrency: organizations.baseCurrency,
      status: organizations.status,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .orderBy(desc(organizations.createdAt));

  if (orgs.length === 0) return { organizations: [], total: 0 };

  const orgIds = orgs.map((o) => o.orgId);

  const memberCounts = await db
    .select({ orgId: members.organizationId, c: sql<number>`count(*)::int` })
    .from(members)
    .where(inArray(members.organizationId, orgIds))
    .groupBy(members.organizationId);
  const memberMap = new Map(memberCounts.map((r) => [r.orgId, r.c]));

  const branchCounts = await db
    .select({ orgId: branches.orgId, c: sql<number>`count(*)::int` })
    .from(branches)
    .where(inArray(branches.orgId, orgIds))
    .groupBy(branches.orgId);
  const branchMap = new Map(branchCounts.map((r) => [r.orgId, r.c]));

  const productCounts = await db
    .select({ orgId: products.orgId, c: sql<number>`count(*)::int` })
    .from(products)
    .where(inArray(products.orgId, orgIds))
    .groupBy(products.orgId);
  const productMap = new Map(productCounts.map((r) => [r.orgId, r.c]));

  const subs = await db
    .select({
      orgId: subscriptions.orgId,
      plan: subscriptions.plan,
      status: subscriptions.status,
      interval: subscriptions.interval,
      seats: subscriptions.seats,
      amountMinor: subscriptions.amountMinor,
      currency: subscriptions.currency,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .where(inArray(subscriptions.orgId, orgIds));
  const subMap = new Map(subs.map((s) => [s.orgId, s]));

  const rows: OrgRow[] = orgs.map((o) => ({
    orgId: o.orgId,
    name: o.name,
    slug: o.slug,
    businessSector: o.businessSector,
    baseCurrency: o.baseCurrency,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
    memberCount: memberMap.get(o.orgId) ?? 0,
    branchCount: branchMap.get(o.orgId) ?? 0,
    productCount: productMap.get(o.orgId) ?? 0,
    subscription: subMap.get(o.orgId)
      ? {
          plan: subMap.get(o.orgId)!.plan,
          status: subMap.get(o.orgId)!.status,
          interval: subMap.get(o.orgId)!.interval,
          seats: subMap.get(o.orgId)!.seats,
          amountMinor: subMap.get(o.orgId)!.amountMinor,
          currency: subMap.get(o.orgId)!.currency,
          currentPeriodEnd: subMap.get(o.orgId)!.currentPeriodEnd.toISOString(),
        }
      : null,
  }));

  return { organizations: rows, total: rows.length };
}

/* ------------------------------------------------------------------ *
 * Organization detail (cross-tenant business summary, audited)
 * ------------------------------------------------------------------ */

export interface OrgDetail {
  org: {
    id: string;
    name: string;
    slug: string;
    businessSector: string;
    baseCurrency: string;
    status: string;
    timezone: string;
    createdAt: string;
  };
  members: {
    userId: string;
    name: string;
    email: string;
    role: string;
    createdAt: string;
  }[];
  branches: { id: string; name: string; isActive: boolean }[];
  productCount: number;
  subscription: {
    plan: string;
    status: string;
    interval: string;
    seats: number;
    amountMinor: number;
    currency: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  } | null;
  recentBilling: {
    action: string;
    reason: string;
    operatorId: string;
    at: string;
  }[];
}

/**
 * Detailed business summary for ONE organization (members, branches,
 * product count, subscription, recent billing). CROSS-TENANT read → writes
 * an `org_detail` audit entry scoped to that org. Operator-gated. Fail-closed:
 * unknown org → 404.
 */
export async function getOrgDetail(
  headers: Headers,
  orgId: string,
): Promise<OrgDetail> {
  const { operatorId } = await requireOperator(headers);
  const db = getAuthDb();

  // Validate the org exists first (fail-closed on unknown id).
  const orgRows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      businessSector: organizations.businessSector,
      baseCurrency: organizations.baseCurrency,
      status: organizations.status,
      timezone: organizations.timezone,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (orgRows.length === 0) {
    throw new ApiError(404, "NOT_FOUND", "Organisation introuvable.");
  }
  const org = orgRows[0]!;

  // Audit the cross-tenant read (fail-closed).
  await auditAccess(operatorId, "org_detail", orgId, "business summary");

  const memberRows = await db
    .select({
      userId: members.userId,
      name: users.name,
      email: users.email,
      role: members.role,
      createdAt: members.createdAt,
    })
    .from(members)
    .innerJoin(users, eq(members.userId, users.id))
    .where(eq(members.organizationId, orgId))
    .orderBy(desc(members.createdAt));

  const branchRows = await db
    .select({ id: branches.id, name: branches.name, isActive: branches.isActive })
    .from(branches)
    .where(eq(branches.orgId, orgId))
    .orderBy(branches.name);

  const productCount = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.orgId, orgId));

  const subRows = await db
    .select({
      plan: subscriptions.plan,
      status: subscriptions.status,
      interval: subscriptions.interval,
      seats: subscriptions.seats,
      amountMinor: subscriptions.amountMinor,
      currency: subscriptions.currency,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId))
    .limit(1);

  const recentBillingRows = await db
    .select({
      action: billingEvents.action,
      reason: billingEvents.reason,
      operatorId: billingEvents.operatorId,
      createdAt: billingEvents.createdAt,
    })
    .from(billingEvents)
    .where(eq(billingEvents.orgId, orgId))
    .orderBy(desc(billingEvents.createdAt))
    .limit(10);

  const sub = subRows[0] ?? null;

  return {
    org: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      businessSector: org.businessSector,
      baseCurrency: org.baseCurrency,
      status: org.status,
      timezone: org.timezone,
      createdAt: org.createdAt.toISOString(),
    },
    members: memberRows.map((m) => ({
      userId: m.userId,
      name: m.name,
      email: m.email,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
    })),
    branches: branchRows.map((b) => ({
      id: b.id,
      name: b.name,
      isActive: b.isActive,
    })),
    productCount: productCount[0]?.c ?? 0,
    subscription: sub
      ? {
          plan: sub.plan,
          status: sub.status,
          interval: sub.interval,
          seats: sub.seats,
          amountMinor: sub.amountMinor,
          currency: sub.currency,
          currentPeriodStart: sub.currentPeriodStart.toISOString(),
          currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
        }
      : null,
    recentBilling: recentBillingRows.map((b) => ({
      action: b.action,
      reason: b.reason,
      operatorId: b.operatorId,
      at: b.createdAt.toISOString(),
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Billing — subscription management (audited mutations)
 * ------------------------------------------------------------------ */

const updateSubscriptionBody = z
  .object({
    plan: z.enum(["free", "pro", "enterprise"]).optional(),
    status: z
      .enum(["trialing", "active", "past_due", "canceled", "suspended"])
      .optional(),
    seats: z.number().int().min(1).max(1000).optional(),
    amountMinor: z.number().int().min(0).max(10_000_000_00).optional(),
    reason: z.string().min(4).max(500),
  })
  .refine(
    (b) =>
      (b.plan ? 1 : 0) +
      (b.status ? 1 : 0) +
      (b.seats ? 1 : 0) +
      (b.amountMinor ? 1 : 0) >=
      1,
    { message: "Au moins un champ de modification est requis." },
  );

export interface SubscriptionUpdate {
  orgId: string;
  plan: string;
  status: string;
  interval: string;
  seats: number;
  amountMinor: number;
  currency: string;
}

/**
 * Update a subscription (plan/status/seats/amount). Creates the subscription
 * row if the org has none (with the requested plan, or `free`). Every change
 * is recorded in the append-only `billing_events` ledger IN THE SAME
 * TRANSACTION as the subscription update (atomic, fail-closed). Operator-gated.
 */
export async function updateSubscription(
  headers: Headers,
  orgId: string,
  raw: unknown,
): Promise<{ subscription: SubscriptionUpdate; action: string }> {
  const body = updateSubscriptionBody.parse(raw);
  const { operatorId } = await requireOperator(headers);
  const db = getAuthDb();

  // Ensure the org exists (fail-closed).
  const orgRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (orgRows.length === 0) {
    throw new ApiError(404, "NOT_FOUND", "Organisation introuvable.");
  }

  const planDef = body.plan ? getPlanDef(body.plan) : undefined;
  if (body.plan && !planDef) {
    throw new ApiError(400, "UNKNOWN_PLAN", `Plan inconnu : ${body.plan}`);
  }

  const now = new Date();
  const periodStart = now;
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  const result = await db.transaction(async (tx) => {
    // Load existing subscription (or none).
    const existing = await tx
      .select({
        id: subscriptions.id,
        plan: subscriptions.plan,
        status: subscriptions.status,
        interval: subscriptions.interval,
        seats: subscriptions.seats,
        amountMinor: subscriptions.amountMinor,
        currency: subscriptions.currency,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .where(eq(subscriptions.orgId, orgId))
      .limit(1);

    const prev = existing[0] ?? null;

    // Resolve the new values (default to existing / plan catalog).
    const newPlan = body.plan ?? prev?.plan ?? "free";
    const newStatus =
      body.status ?? (prev ? prev.status : planDef?.billable ? "trialing" : "active");
    const newSeats = body.seats ?? prev?.seats ?? planDef?.seats ?? 1;
    const newAmount =
      body.amountMinor ??
      (prev?.amountMinor ?? planDef?.amountMinor ?? 0);
    const newInterval = prev?.interval ?? "monthly";
    const newCurrency = prev?.currency ?? "USD";

    // Determine the billing action for the ledger.
    let action: string;
    if (!prev) action = "created";
    else if (body.plan && body.plan !== prev.plan) action = "plan_changed";
    else if (body.status && body.status !== prev.status) action = "status_changed";
    else if (body.seats && body.seats !== prev.seats) action = "seats_changed";
    else if (body.amountMinor && body.amountMinor !== prev.amountMinor)
      action = "amount_changed";
    else action = "plan_changed";

    if (prev) {
      await tx
        .update(subscriptions)
        .set({
          plan: newPlan,
          status: newStatus,
          seats: newSeats,
          amountMinor: newAmount,
          interval: newInterval,
          currency: newCurrency,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, prev.id));
    } else {
      await tx.insert(subscriptions).values({
        id: uuidv7(),
        orgId,
        plan: newPlan,
        status: newStatus,
        interval: newInterval,
        seats: newSeats,
        amountMinor: newAmount,
        currency: newCurrency,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Append-only billing audit (same transaction).
    await tx.insert(billingEvents).values({
      id: uuidv7(),
      subscriptionId: prev?.id ?? uuidv7(),
      orgId,
      action: action as
        | "created"
        | "plan_changed"
        | "status_changed"
        | "seats_changed"
        | "amount_changed"
        | "period_renewed",
      operatorId,
      reason: body.reason.trim(),
      previousPlan: prev?.plan ?? null,
      previousStatus: prev?.status ?? null,
      previousSeats: prev?.seats ?? null,
      newPlan,
      newStatus,
      newSeats,
      createdAt: now,
    });

    return {
      plan: newPlan,
      status: newStatus,
      interval: newInterval,
      seats: newSeats,
      amountMinor: newAmount,
      currency: newCurrency,
    };
  });

  return {
    subscription: { orgId, ...result },
    action: body.plan ? "plan_changed" : "status_changed",
  };
}

/* ------------------------------------------------------------------ *
 * Billing ledger + access log (read-only, operator-gated)
 * ------------------------------------------------------------------ */

export interface BillingEventRow {
  id: string;
  orgId: string;
  action: string;
  operatorId: string;
  reason: string;
  previousPlan: string | null;
  newPlan: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  previousSeats: number | null;
  newSeats: number | null;
  at: string;
}

/** Recent billing events across all orgs (operator-gated, cross-tenant read). */
export async function listBillingEvents(
  headers: Headers,
  limit = 50,
): Promise<{ events: BillingEventRow[] }> {
  const { operatorId } = await requireOperator(headers);
  const db = getAuthDb();
  // Cross-tenant read → audit (org_list scope, detail = billing ledger).
  await auditAccess(operatorId, "org_list", null, "billing ledger");

  const rows = await db
    .select({
      id: billingEvents.id,
      orgId: billingEvents.orgId,
      action: billingEvents.action,
      operatorId: billingEvents.operatorId,
      reason: billingEvents.reason,
      previousPlan: billingEvents.previousPlan,
      newPlan: billingEvents.newPlan,
      previousStatus: billingEvents.previousStatus,
      newStatus: billingEvents.newStatus,
      previousSeats: billingEvents.previousSeats,
      newSeats: billingEvents.newSeats,
      createdAt: billingEvents.createdAt,
    })
    .from(billingEvents)
    .orderBy(desc(billingEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));

  return {
    events: rows.map((r) => ({
      id: r.id,
      orgId: r.orgId,
      action: r.action,
      operatorId: r.operatorId,
      reason: r.reason,
      previousPlan: r.previousPlan,
      newPlan: r.newPlan,
      previousStatus: r.previousStatus,
      newStatus: r.newStatus,
      previousSeats: r.previousSeats,
      newSeats: r.newSeats,
      at: r.createdAt.toISOString(),
    })),
  };
}

export interface AccessLogRow {
  id: string;
  operatorId: string;
  action: string;
  orgId: string | null;
  detail: string | null;
  at: string;
}

/** Recent platform-access audit entries (operator-gated, cross-tenant read). */
export async function listAccessLog(
  headers: Headers,
  limit = 50,
): Promise<{ entries: AccessLogRow[] }> {
  const { operatorId } = await requireOperator(headers);
  const db = getAuthDb();
  // Reading the access log is itself a cross-tenant read → audit it.
  await auditAccess(operatorId, "org_list", null, "access log");

  const rows = await db
    .select({
      id: platformAccessLog.id,
      operatorId: platformAccessLog.operatorId,
      action: platformAccessLog.action,
      orgId: platformAccessLog.orgId,
      detail: platformAccessLog.detail,
      createdAt: platformAccessLog.createdAt,
    })
    .from(platformAccessLog)
    .orderBy(desc(platformAccessLog.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));

  return {
    entries: rows.map((r) => ({
      id: r.id,
      operatorId: r.operatorId,
      action: r.action,
      orgId: r.orgId,
      detail: r.detail,
      at: r.createdAt.toISOString(),
    })),
  };
}

/** Platform summary stats (operator-gated, cross-tenant read → audited). */
export async function platformStats(headers: Headers): Promise<{
  totalOrgs: number;
  totalMembers: number;
  totalBranches: number;
  totalProducts: number;
  plans: Record<string, number>;
  revenue30dMinor: number;
}> {
  const { operatorId } = await requireOperator(headers);
  const db = getAuthDb();
  await auditAccess(operatorId, "org_list", null, "platform stats");

  const orgCount = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(organizations);
  const memberCount = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(members);
  const branchCount = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(branches);
  const productCount = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(products);

  const planRows = await db
    .select({ plan: subscriptions.plan, c: sql<number>`count(*)::int` })
    .from(subscriptions)
    .groupBy(subscriptions.plan);

  const plans: Record<string, number> = { free: 0, pro: 0, enterprise: 0 };
  for (const r of planRows) plans[r.plan] = r.c;

  const revenueRows = await db
    .select({ amountMinor: subscriptions.amountMinor })
    .from(subscriptions)
    .where(
      and(
        sql`${subscriptions.status} IN ('active', 'trialing', 'past_due')`,
        sql`${subscriptions.currentPeriodStart} >= now() - interval '30 days'`,
      ),
    );
  const revenue30dMinor = revenueRows.reduce(
    (sum, r) => sum + (r.amountMinor ?? 0),
    0,
  );

  return {
    totalOrgs: orgCount[0]?.c ?? 0,
    totalMembers: memberCount[0]?.c ?? 0,
    totalBranches: branchCount[0]?.c ?? 0,
    totalProducts: productCount[0]?.c ?? 0,
    plans,
    revenue30dMinor,
  };
}
