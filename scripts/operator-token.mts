/**
 * OPERATOR-TOKEN ISSUANCE & REVOCATION (ADR-0014 + CTO hardening).
 *
 * SERVER-SIDE, NO PUBLIC ADMIN ENDPOINT. This script is run on a server with
 * Better Auth + DB access. The operator's identity comes from their
 * AUTHENTICATED session cookie (`OPERATOR_SESSION_COOKIE`), verified via Better
 * Auth, and they must be an AUTHORIZED platform operator
 * (`PLATFORM_OPERATOR_EMAILS` allowlist). The token `sub` is the session
 * user's real id — NEVER a typed argument.
 *
 * Subcommands:
 *   issue                    -> mint a 15-minute token (jti), audit + log it
 *   revoke --jti <jti> \
 *          --reason <reason> -> revoke a token (audit + log it)
 *
 * Every issuance and revocation is written to an append-only ledger. No secret
 * or session cookie is logged.
 *
 * Run (on a server with the app env — BETTER_AUTH_SECRET, BETTER_AUTH_URL,
 *   AUTH_DATABASE_URL, DATABASE_URL, OPERATOR_TOKEN_SECRET,
 *   PLATFORM_OPERATOR_EMAILS):
 *   OPERATOR_SESSION_COOKIE='<better-auth session cookie>' \
 *     node --import tsx scripts/operator-token.mts issue
 *   OPERATOR_SESSION_COOKIE='<better-auth session cookie>' \
 *     node --import tsx scripts/operator-token.mts revoke --jti <uuid> \
 *       --reason "token rotated after suspected exposure"
 */
import { closeAuthDb } from "../src/auth/db";
import {
  issueOperatorTokenForAuthenticatedSession,
  revokeOperatorToken,
  OperatorTokenError,
} from "../src/server/operator-token";

function fail(msg: string): never {
  console.error(`[operator-token] ${msg}`);
  process.exit(1);
}

const cmd = process.argv[2];

const cookie = process.env.OPERATOR_SESSION_COOKIE;
if (!cookie) {
  fail(
    "OPERATOR_SESSION_COOKIE is required — the AUTHENTICATED platform-operator " +
      "session (from a real sign-in). Identity is never typed.",
  );
}
const headers = new Headers({ cookie });

try {
  if (cmd === "issue") {
    const ttlFlag = process.argv.indexOf("--ttl");
    const opts =
      ttlFlag >= 0
        ? { ttlSeconds: Number(process.argv[ttlFlag + 1]) }
        : undefined;
    const issued = await issueOperatorTokenForAuthenticatedSession(
      headers,
      opts,
    );
    // The token is the ONLY stdout line the operator should copy. It is a
    // capability; treat it as sensitive (15-minute life).
    console.log(
      `ISSUED jti=${issued.jti} sub=${issued.sub} ttl=${issued.ttlSeconds}s`,
    );
    console.log(issued.token);
  } else if (cmd === "revoke") {
    const argv = process.argv.slice(3);
    const jtiFlag = argv.indexOf("--jti");
    const reasonFlag = argv.indexOf("--reason");
    const jti = jtiFlag >= 0 ? argv[jtiFlag + 1] : undefined;
    const reason = reasonFlag >= 0 ? argv[reasonFlag + 1] : undefined;
    if (!jti) fail("--jti <uuid> is required.");
    if (!reason || reason.trim().length === 0) {
      fail("--reason is required (mandatory for revocation).");
    }
    const result = await revokeOperatorToken(headers, jti, reason);
    console.log(
      `REVOKED jti=${result.jti} by sub=${result.revokerSub} at=${result.at.toISOString()}`,
    );
  } else {
    fail('usage: operator-token.mts issue | revoke --jti <uuid> --reason <text>');
  }
} catch (e) {
  if (e instanceof OperatorTokenError) fail(e.message);
  throw e;
} finally {
  await closeAuthDb();
}
