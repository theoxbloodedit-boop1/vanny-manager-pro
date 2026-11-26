/**
 * OPERATOR-TOKEN ISSUANCE & REVOCATION (ADR-0014 + CTO hardening) — server-side.
 *
 * No public admin endpoint. These functions run on a server with DB + Better
 * Auth access (see scripts/operator-token.mts). They enforce that the operator
 * token's `sub` comes from an AUTHENTICATED + AUTHORIZED platform-operator
 * session, and that revocation is checked server-side on every use.
 *
 *   - Issuance is tied to a verified session: `sub` = the session user's real id
 *     (NEVER free text), and the user must be an authorized platform operator
 *     (env allowlist `PLATFORM_OPERATOR_EMAILS`). Empty allowlist = nobody can
 *     issue (fails closed).
 *   - Every issuance + revocation is written to an APPEND-ONLY ledger and
 *     logged (no secret, no session cookie, no password).
 *   - Revocation is a jti denylist, checked on EVERY token use.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getAuth } from "../auth";
import { getAuthDb } from "../auth/db";
import {
  operatorTokenIssuances,
  operatorTokenRevocations,
} from "../db/schema/auth";
import {
  issueOperatorToken,
  verifyOperatorToken,
  type OperatorIdentity,
} from "../lib/operator-token";

const DEFAULT_TTL_SECONDS = 900; // 15 minutes

export class OperatorTokenError extends Error {}

/**
 * Authorized platform operators = emails listed in `PLATFORM_OPERATOR_EMAILS`
 * (comma-separated, case-insensitive). Unset/empty → nobody is authorized
 * (fail-closed). This is the AUTHORIZATION half; the session is the
 * AUTHENTICATION half.
 */
export function isAuthorizedPlatformOperator(email: string): boolean {
  const raw = process.env.PLATFORM_OPERATOR_EMAILS;
  if (!raw || raw.trim().length === 0) return false;
  const allowed = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

/** True if the given jti has been revoked (append-only denylist). */
export async function isOperatorTokenRevoked(jti: string): Promise<boolean> {
  const db = getAuthDb();
  const rows = await db
    .select({ jti: operatorTokenRevocations.jti })
    .from(operatorTokenRevocations)
    .where(eq(operatorTokenRevocations.jti, jti))
    .limit(1);
  return rows.length > 0;
}

/**
 * FULL verification used on EVERY token use: synchronous signature/expiry/role/
 * jti check + asynchronous server-side revocation check. Fails closed.
 */
export async function verifyOperatorTokenFull(
  token: string,
  secret: string,
): Promise<OperatorIdentity> {
  const identity = verifyOperatorToken(token, secret); // throws if invalid/expired/...
  const revoked = await isOperatorTokenRevoked(identity.jti);
  if (revoked) {
    throw new OperatorTokenError("operator token: revoked");
  }
  return identity;
}

export interface IssuedOperatorToken {
  token: string;
  jti: string;
  sub: string;
  ttlSeconds: number;
}

/**
 * Issue a 15-minute operator token bound to the caller's AUTHENTICATED session.
 * Requires a valid session AND that the session user is an authorized platform
 * operator. Writes an append-only issuance record + logs (no secret/cookie).
 */
export async function issueOperatorTokenForAuthenticatedSession(
  headers: Headers,
  opts?: { ttlSeconds?: number },
): Promise<IssuedOperatorToken> {
  const secret = process.env.OPERATOR_TOKEN_SECRET;
  if (!secret) {
    throw new OperatorTokenError("OPERATOR_TOKEN_SECRET is not configured");
  }
  const session = await getAuth().api.getSession({ headers });
  const user = session?.user;
  if (!user?.id || !user?.email) {
    throw new OperatorTokenError(
      "operator issuance: no authenticated session (operator must sign in)",
    );
  }
  if (!isAuthorizedPlatformOperator(user.email)) {
    throw new OperatorTokenError(
      "operator issuance: session user is not an authorized platform operator",
    );
  }
  const ttlSeconds = opts?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const jti = randomUUID();
  const token = issueOperatorToken(secret, user.id, { jti, ttlSeconds });

  // Append-only issuance audit.
  const db = getAuthDb();
  await db.insert(operatorTokenIssuances).values({
    id: randomUUID(),
    jti,
    operatorSub: user.id,
    operatorEmail: user.email,
    ttlSeconds,
    issuedAt: new Date(),
  });
  // PII-free of secrets/cookie: identity + jti + ttl only.
  console.log(
    `[operator-token] issued sub=${user.id} email=${user.email} jti=${jti} ttl=${ttlSeconds}s at=${new Date().toISOString()}`,
  );
  return { token, jti, sub: user.id, ttlSeconds };
}

/**
 * Revoke an operator token by jti. Requires an authenticated + authorized
 * platform-operator session and a mandatory reason. Append-only + logged.
 */
export async function revokeOperatorToken(
  headers: Headers,
  jti: string,
  reason: string,
): Promise<{ jti: string; revokerSub: string; at: Date }> {
  const trimmed = reason?.trim();
  if (!trimmed) {
    throw new OperatorTokenError("a reason is required to revoke a token");
  }
  if (!jti || jti.length === 0) {
    throw new OperatorTokenError("jti is required");
  }
  const session = await getAuth().api.getSession({ headers });
  const user = session?.user;
  if (!user?.id || !user?.email) {
    throw new OperatorTokenError(
      "operator revocation: no authenticated session (operator must sign in)",
    );
  }
  if (!isAuthorizedPlatformOperator(user.email)) {
    throw new OperatorTokenError(
      "operator revocation: session user is not an authorized platform operator",
    );
  }

  const db = getAuthDb();
  const at = new Date();
  try {
    await db.insert(operatorTokenRevocations).values({
      id: randomUUID(),
      jti,
      revokerSub: user.id,
      reason: trimmed,
      revokedAt: at,
    });
  } catch (e) {
    // Unique index on jti → a second revocation of the same jti conflicts.
    throw new OperatorTokenError(
      `operator token already revoked (jti=${jti}): ${(e as Error).message}`,
    );
  }
  console.log(
    `[operator-token] revoked jti=${jti} by sub=${user.id} reason="${trimmed}" at=${at.toISOString()}`,
  );
  return { jti, revokerSub: user.id, at };
}
