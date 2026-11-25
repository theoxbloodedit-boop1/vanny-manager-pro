/**
 * AUDITED MANUAL-APPROVAL SCRIPT (ADR-0014).
 *
 * Sets or revokes a user's `manually_approved` flag and writes an append-only
 * audit row — in a SINGLE transaction (see applyManualApproval).
 *
 * OPERATOR IDENTITY — CRITICAL (owner condition):
 *   The operator's identity comes from a VERIFIED token (`OPERATOR_TOKEN`). The
 *   token was ISSUED by scripts/operator-token.mts from an AUTHENTICATED +
 *   AUTHORIZED platform-operator session (its `sub` is the session user's real
 *   id, never free text). It is NEVER taken from a command-line argument.
 *   Verification is FULL and server-side on every use: signature, expiry,
 *   role, jti, AND the revocation denylist. The script FAILS CLOSED if the
 *   token is missing, invalid, expired, not a platform-operator, or REVOKED.
 *
 * The OPERATION parameters (target user, action, reason) are the DATA being
 * operated on — they come from arguments. They are NOT the identity.
 *
 * No operator password is stored. No secret or password is logged.
 *
 * Run (on a server with DB access):
 *   OPERATOR_TOKEN=<signed jwt> OPERATOR_TOKEN_SECRET=<secret> \
 *   AUTH_DATABASE_URL=postgres://owner@host/db \
 *   node_modules/.bin/tsx scripts/manual-approval.mts \
 *     --user alice@example.com --action approve \
 *     --reason "identity confirmed via WhatsApp call 2026-11-25"
 */
import { closeAuthDb } from "../src/auth/db";
import {
  applyManualApproval,
  ManualApprovalError,
  type ManualApprovalAction,
} from "../src/server/manual-approval";
import { verifyOperatorTokenFull } from "../src/server/operator-token";

function fail(msg: string): never {
  console.error(`[manual-approval] ${msg}`);
  process.exit(1);
}

// --- Operator identity: from the VERIFIED token (trusted context), never an arg ---
const token = process.env.OPERATOR_TOKEN;
const secret = process.env.OPERATOR_TOKEN_SECRET;
if (!token) {
  fail(
    "OPERATOR_TOKEN is required — a verified operator token from an " +
      "authenticated execution context (not a typed argument).",
  );
}
if (!secret) {
  fail(
    "OPERATOR_TOKEN_SECRET is required — the trusted HS256 signing secret, " +
      "provided by the environment (never hard-coded).",
  );
}

// Full server-side verification on every use: signature + expiry + role + jti
// + REVOCATION denylist. Fails closed on any failure (incl. a revoked jti).
let operatorSub: string;
let operatorJti: string;
try {
  const identity = await verifyOperatorTokenFull(token, secret);
  operatorSub = identity.sub;
  operatorJti = identity.jti;
} catch (e) {
  fail(`operator token verification failed: ${(e as Error).message}`);
}

// --- Operation parameters (data, not identity) ---
const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}
const userEmail = argValue("--user");
const action = argValue("--action") as ManualApprovalAction | undefined;
const reason = argValue("--reason");

if (!userEmail) fail("--user <email> is required.");
if (action !== "approve" && action !== "revoke") {
  fail("--action must be 'approve' or 'revoke'.");
}
if (!reason || reason.trim().length === 0) {
  fail("--reason is required (mandatory for manual approval).");
}

try {
  const result = await applyManualApproval({
    operatorId: operatorSub,
    userEmail,
    action: action as ManualApprovalAction,
    reason,
  });
  // Audit line: operator (+ jti of the verified token), user, action, UTC date,
  // reason, operation id. NO secret, NO password, NO cookie.
  console.log(
    `[manual-approval] operator=${operatorSub} token_jti=${operatorJti} ` +
      `user=${result.userEmail} action=${action} ` +
      `manually_approved=${result.manuallyApproved} ` +
      `operation_id=${result.operationId} reason="${reason}" ` +
      `at=${result.at.toISOString()}`,
  );
} catch (e) {
  if (e instanceof ManualApprovalError) fail(e.message);
  throw e;
} finally {
  await closeAuthDb();
}
