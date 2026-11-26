/**
 * Platform-operator token (ADR-0014 + CTO hardening) — dependency-free HS256 JWT.
 *
 * The manual-approval script must derive the operator's identity from an
 * AUTHENTICATED execution context, NEVER from a freely-typed command-line
 * argument (a typed identity is not proof of identity).
 *
 * CTO hardening (2026-11-25):
 *   - Every token carries a UNIQUE `jti` (UUID) so it can be individually
 *     revoked and its reuse detected.
 *   - Default lifetime is 15 minutes (least privilege).
 *   - `verifyOperatorToken` is the SYNC signature/expiry/role/jti check. The
 *     server-side REVOCATION check (against the append-only denylist) is a
 *     separate async step — see src/server/operator-token.ts. A token is only
 *     accepted when BOTH pass, on EVERY use.
 *
 * Verification FAILS CLOSED: any missing/invalid/expired/wrong-role/missing-jti
 * token throws. The signing secret is supplied at runtime (env), never hard-coded.
 * Issuance (linking `sub` to an authenticated session) is server-side — see
 * src/server/operator-token.ts and scripts/operator-token.mts.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const EXPECTED_ISS = "vanny-operator";
const REQUIRED_ROLE = "platform-operator";
/** 15 minutes — least-privilege default lifetime. */
const DEFAULT_TTL_SECONDS = 900;

export interface OperatorIdentity {
  /** The verified operator's real identifier (token `sub` claim). */
  sub: string;
  /** The token's unique id (token `jti` claim) — used for revocation. */
  jti: string;
}

function decodeSegment<T>(b64url: string, what: string): T {
  try {
    return JSON.parse(Buffer.from(b64url, "base64url").toString("utf8")) as T;
  } catch {
    throw new Error(`operator token: malformed ${what}`);
  }
}

/**
 * Verify a platform-operator token (signature, expiry, role, issuer, jti) and
 * return `{ sub, jti }`. `secret` is the trusted HS256 signing secret (env).
 * This is the SYNCHRONOUS half; the caller must also run the async revocation
 * check (`isOperatorTokenRevoked(jti)`) before accepting the token.
 */
export function verifyOperatorToken(
  token: string,
  secret: string,
): OperatorIdentity {
  if (!token || !secret) throw new Error("operator token: token/secret missing");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("operator token: malformed");
  const [h64, p64, s64] = parts as [string, string, string];

  const header = decodeSegment<{ alg?: string; typ?: string }>(h64, "header");
  if (header.alg !== "HS256") {
    throw new Error("operator token: unsupported algorithm");
  }

  // Verify the signature in constant time (compare the decoded raw bytes).
  const expected = createHmac("sha256", secret).update(`${h64}.${p64}`).digest();
  const given = Buffer.from(s64, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Error("operator token: invalid signature");
  }

  const claims = decodeSegment<{
    sub?: unknown;
    jti?: unknown;
    exp?: unknown;
    iss?: unknown;
    role?: unknown;
  }>(p64, "payload");

  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new Error("operator token: missing subject");
  }
  // A token must carry a jti so it can be revoked. Legacy tokens (no jti) are
  // refused: they cannot be individually revoked.
  if (typeof claims.jti !== "string" || claims.jti.length === 0) {
    throw new Error("operator token: missing jti");
  }
  if (typeof claims.exp !== "number" || Date.now() >= claims.exp * 1000) {
    throw new Error("operator token: expired");
  }
  if (claims.role !== REQUIRED_ROLE) {
    throw new Error("operator token: not a platform operator");
  }
  if (typeof claims.iss === "string" && claims.iss !== EXPECTED_ISS) {
    throw new Error("operator token: unexpected issuer");
  }
  return { sub: claims.sub, jti: claims.jti };
}

export interface IssueOptions {
  /** Unique token id. Defaults to a fresh random UUID. */
  jti?: string;
  /** Lifetime in seconds. Default 900 (15 minutes). */
  ttlSeconds?: number;
  /** Test hook: fixed "now" in ms. */
  nowMs?: number;
  role?: string;
  iss?: string;
}

/**
 * Mint a platform-operator token (HS256). The `sub` MUST be the authenticated
 * operator's real identifier (see src/server/operator-token.ts — it is derived
 * from a verified session, never free text). Carries a unique `jti` and a
 * 15-minute default lifetime.
 */
export function issueOperatorToken(
  secret: string,
  sub: string,
  opts?: IssueOptions,
): string {
  const now = Math.floor((opts?.nowMs ?? Date.now()) / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub,
    jti: opts?.jti ?? randomUUID(),
    iss: opts?.iss ?? EXPECTED_ISS,
    role: opts?.role ?? REQUIRED_ROLE,
    iat: now,
    exp: now + (opts?.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  };
  const h64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret)
    .update(`${h64}.${p64}`)
    .digest("base64url");
  return `${h64}.${p64}.${sig}`;
}
