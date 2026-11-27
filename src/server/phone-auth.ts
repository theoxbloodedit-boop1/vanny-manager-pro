/**
 * PHONE (WHATSAPP) SIGN-UP + OPERATOR APPROVAL (ADR-0016) — service layer.
 *
 * Identity: phone number (E.164) → deterministic virtual email → the standard
 * Better Auth email credential. The number is stored in `user.phone`; the
 * virtual email is an identifier only (never delivered to — see
 * src/server/email.ts).
 *
 * Trust: a phone account is INERT until an authorized platform operator
 * approves it via the ADR-0014 audited flow (`applyManualApproval`, one
 * transaction: flag + append-only audit). The operator identity for the
 * in-app path is the AUTHENTICATED SESSION (same trust model as every other
 * in-app mutation; the CLI token path is unchanged).
 */
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import * as z from "zod";
import { getAuth } from "../auth";
import { getAuthDb } from "../auth/db";
import { manualApprovals, users } from "../db/schema/auth";
import { ApiError } from "./errors";
import { isAuthorizedPlatformOperator } from "./operator-token";
import { applyManualApproval, ManualApprovalError } from "./manual-approval";
import {
  normalizePhone,
  PhoneError,
  phoneToVirtualEmail,
} from "./phone";

/** normalizePhone → ApiError(400) so bad input is a clean validation error. */
function normalizeOrThrow(input: string): string {
  try {
    return normalizePhone(input);
  } catch (e) {
    if (e instanceof PhoneError) {
      throw new ApiError(400, "INVALID_PHONE", e.message);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Forward a Better Auth `asResponse` result to a Response: same status, same
 * JSON body, and — critically — the session Set-Cookie(s), which is how the
 * browser becomes signed in (httpOnly cookie, JS never reads it).
 */
function forwardAuthResponse(res: Response): Response {
  const headers = new Headers();
  for (const c of res.headers.getSetCookie()) headers.append("Set-Cookie", c);
  return new Response(res.body, { status: res.status, headers });
}

/** Map a failed Better Auth response body to a uniform ApiError. */
async function assertAuthOk(res: Response, action: string) {
  if (res.ok) return;
  let message = `${action} impossible.`;
  let code = "ERROR";
  try {
    const body = (await res.json()) as { message?: unknown; code?: unknown };
    if (typeof body.message === "string") message = body.message;
    if (typeof body.code === "string") code = body.code;
  } catch {
    /* keep defaults */
  }
  throw new ApiError(res.status >= 500 ? 500 : res.status, code, message);
}

// ---------------------------------------------------------------------------
// Sign-up / sign-in
// ---------------------------------------------------------------------------

const signUpPhoneBody = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(5).max(32),
  password: z.string().min(8).max(128),
});

/**
 * Create a phone account: normalize → dedup check → Better Auth sign-up with
 * the virtual email → store the E.164 number. Returns the session response
 * (Set-Cookie) exactly like a stock email sign-up.
 */
export async function signUpByPhone(raw: unknown): Promise<Response> {
  const body = signUpPhoneBody.parse(raw);
  const e164 = normalizeOrThrow(body.phone);
  const virtualEmail = phoneToVirtualEmail(e164);

  const db = getAuthDb();

  // Dedup by phone (the unique index on user.phone is the backstop).
  const byPhone = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, e164))
    .limit(1);
  if (byPhone.length > 0) {
    throw new ApiError(
      409,
      "PHONE_TAKEN",
      "Ce numéro est déjà inscrit. Connectez-vous avec ce numéro.",
    );
  }

  const auth = getAuth();
  const res = (await auth.api.signUpEmail({
    body: { name: body.name, email: virtualEmail, password: body.password },
    asResponse: true,
    returnHeaders: true,
  })) as unknown as Response;
  await assertAuthOk(res, "Inscription");

  // Store the E.164 number (the virtual email already guarantees uniqueness).
  await db.update(users).set({ phone: e164 }).where(eq(users.email, virtualEmail));

  return forwardAuthResponse(res);
}

const signInPhoneBody = z.object({
  phone: z.string().min(5).max(32),
  password: z.string().min(1).max(128),
});

/** Sign in with phone + password (virtual email → standard credential check). */
export async function signInByPhone(raw: unknown): Promise<Response> {
  const body = signInPhoneBody.parse(raw);
  const e164 = normalizeOrThrow(body.phone);
  const virtualEmail = phoneToVirtualEmail(e164);

  const auth = getAuth();
  const res = (await auth.api.signInEmail({
    body: { email: virtualEmail, password: body.password },
    asResponse: true,
    returnHeaders: true,
  })) as unknown as Response;
  await assertAuthOk(res, "Connexion");
  return forwardAuthResponse(res);
}

// ---------------------------------------------------------------------------
// Operator dashboard (platform)
// ---------------------------------------------------------------------------

export interface PendingPhoneUser {
  userId: string;
  name: string;
  phone: string;
  email: string;
  createdAt: Date;
}

/**
 * ADR-0017 — an EMAIL account (no WhatsApp number) that is neither verified
 * nor manually approved. These are exactly the accounts that appear after an
 * invitation: the invitee signs up with the invited email, then cannot pass
 * the verification gate until an operator approves them (ADR-0014 audited
 * flow) — the in-app alternative to the email-verification link.
 */
export interface PendingEmailUser {
  userId: string;
  name: string;
  email: string;
  createdAt: Date;
}

export interface RecentApproval {
  userId: string;
  name: string;
  /** null for email-only (invited) accounts — ADR-0017. */
  phone: string | null;
  email: string;
  action: string;
  reason: string;
  operatorId: string;
  at: Date;
}

/**
 * Operator gate (ADR-0016): the AUTHENTICATED session must be an authorized
 * platform operator (fail-closed allowlist). The session IS the identity —
 * same trust model as every other in-app mutation; the CLI token path
 * (ADR-0014) is unchanged.
 */
export async function requireOperator(
  headers: Headers,
): Promise<{ operatorId: string }> {
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
  return { operatorId: user.id };
}

/**
 * Pending phone sign-ups (phone set, not approved yet) + pending email
 * accounts (ADR-0017: invited users awaiting manual approval) + the most
 * recent phone-account approvals, each correlated with its latest audit row.
 * Platform tables only — never tenant data. Operator-gated.
 */
export async function listPhoneApprovals(headers: Headers): Promise<{
  pending: PendingPhoneUser[];
  pendingEmail: PendingEmailUser[];
  recent: RecentApproval[];
}> {
  await requireOperator(headers);
  const db = getAuthDb();

  const pendingRows = await db
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      email: users.email,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(isNotNull(users.phone), eq(users.manuallyApproved, false)))
    .orderBy(desc(users.createdAt))
    .limit(100);

  const pending: PendingPhoneUser[] = pendingRows
    .filter((r) => r.phone !== null)
    .map((r) => ({
      userId: r.id,
      name: r.name,
      phone: r.phone as string,
      email: r.email,
      createdAt: r.createdAt,
    }));

  // ADR-0017: email accounts (no phone) that are neither verified nor
  // approved — invited users who cannot receive the verification email
  // (e.g. no mailbox / Resend not configured) wait here for manual approval.
  const pendingEmailRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(
      and(
        isNull(users.phone),
        eq(users.emailVerified, false),
        eq(users.manuallyApproved, false),
      ),
    )
    .orderBy(desc(users.createdAt))
    .limit(100);

  const pendingEmail: PendingEmailUser[] = pendingEmailRows.map((r) => ({
    userId: r.id,
    name: r.name,
    email: r.email,
    createdAt: r.createdAt,
  }));

  // ADR-0017: recently approved accounts of BOTH kinds (phone + email).
  const approvedRows = await db
    .select({ id: users.id, name: users.name, phone: users.phone, email: users.email })
    .from(users)
    .where(eq(users.manuallyApproved, true))
    .orderBy(desc(users.updatedAt))
    .limit(20);

  const recent: RecentApproval[] = [];
  if (approvedRows.length > 0) {
    const auditRows = await db
      .select({
        userId: manualApprovals.userId,
        action: manualApprovals.action,
        reason: manualApprovals.reason,
        operatorId: manualApprovals.operatorId,
        createdAt: manualApprovals.createdAt,
      })
      .from(manualApprovals)
      .where(inArray(manualApprovals.userId, approvedRows.map((u) => u.id)))
      .orderBy(desc(manualApprovals.createdAt));

    const latestByUser = new Map<string, (typeof auditRows)[number]>();
    for (const row of auditRows) {
      if (!latestByUser.has(row.userId)) latestByUser.set(row.userId, row);
    }
    for (const u of approvedRows) {
      const latest = latestByUser.get(u.id);
      if (latest) {
        recent.push({
          userId: u.id,
          name: u.name,
          phone: u.phone,
          email: u.email,
          action: latest.action,
          reason: latest.reason,
          operatorId: latest.operatorId,
          at: latest.createdAt,
        });
      }
    }
  }

  return { pending, pendingEmail, recent };
}

/**
 * ADR-0017: the operator targets EITHER a WhatsApp number (phone account) OR
 * an email address (email/invited account) — exactly one of the two.
 */
const approvalBody = z
  .object({
    phone: z.string().min(5).max(32).optional(),
    email: z.string().min(3).max(320).email().optional(),
    action: z.enum(["approve", "revoke"]),
    reason: z.string().min(4).max(500),
  })
  .refine((b) => (b.phone ? 1 : 0) + (b.email ? 1 : 0) === 1, {
    message: "Fournir soit un numéro WhatsApp, soit une adresse email.",
  });

/**
 * Approve / revoke a phone sign-up. Identity = the AUTHENTICATED session,
 * which must be an authorized platform operator (fail-closed allowlist).
 * The mutation is the ADR-0014 audited flow, verbatim (atomic flag + audit).
 */
export async function operatorApplyApproval(
  headers: Headers,
  raw: unknown,
): Promise<{
  userId: string;
  userEmail: string;
  manuallyApproved: boolean;
  operationId: string;
}> {
  const body = approvalBody.parse(raw);
  const { operatorId } = await requireOperator(headers);

  const db = getAuthDb();
  let target: { id: string; email: string; phone: string | null };
  if (body.email) {
    // ADR-0017: email/invited account — matched directly on its email.
    const rows = await db
      .select({ id: users.id, email: users.email, phone: users.phone })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);
    if (rows.length === 0) {
      throw new ApiError(404, "NOT_FOUND", "Aucun compte avec cet email.");
    }
    target = rows[0]!;
  } else {
    // .refine guarantees exactly one of phone/email, but TS can't see through
    // it — narrow explicitly.
    const phone = body.phone;
    if (!phone) {
      throw new ApiError(400, "BAD_REQUEST", "Numéro WhatsApp requis.");
    }
    const e164 = normalizeOrThrow(phone);
    const virtualEmail = phoneToVirtualEmail(e164);
    const rows = await db
      .select({ id: users.id, email: users.email, phone: users.phone })
      .from(users)
      .where(eq(users.email, virtualEmail))
      .limit(1);
    if (rows.length === 0 || rows[0]!.phone === null) {
      throw new ApiError(404, "NOT_FOUND", "Aucun compte WhatsApp avec ce numéro.");
    }
    target = rows[0]!;
  }

  try {
    const result = await applyManualApproval({
      operatorId,
      userEmail: target.email,
      action: body.action,
      reason: body.reason,
    });
    return {
      userId: result.userId,
      userEmail: result.userEmail,
      manuallyApproved: result.manuallyApproved,
      operationId: result.operationId,
    };
  } catch (e) {
    if (e instanceof ManualApprovalError) {
      throw new ApiError(400, "MANUAL_APPROVAL_FAILED", e.message);
    }
    throw e;
  }
}
