import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { urlsFor, startPostgres, stopPostgres } from "./pg-harness";
import { getAuth, resetAuth } from "../../src/auth";
import { closeAuthDb } from "../../src/auth/db";
import { closeTenantPool } from "../../src/db/tenant";
import { takeCapturedMails } from "../../src/server/email";
import { runOnboarding } from "../../src/server/onboarding";
import {
  inviteMember,
  acceptInvitation,
  myInvitations,
  listBranches,
  listMembers,
} from "../../src/server/members";
import { applyManualApproval } from "../../src/server/manual-approval";
import { withTenantDb } from "../../src/db/tenant";
import { authorize } from "../../src/server/rbac/authorize";
import {
  issueOperatorToken,
  verifyOperatorToken,
} from "../../src/lib/operator-token";

const pexecFile = promisify(execFile);

const TEST_SECRET =
  "integration-test-secret-not-for-production-0123456789abcdef";
// Trusted HS256 signing secret for the operator token (test-only, env-injected).
const OPERATOR_SECRET =
  "test-operator-signing-secret-not-for-production-424242";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

let admin: Pool;
const { APP_URL, ADMIN_URL } = urlsFor("approvals");

/** Sign up like a browser (session cookie = signed token). */
async function signup(name: string, email: string) {
  const res = (await getAuth().api.signUpEmail({
    body: { name, email, password: "S3cure!pass" },
    asResponse: true,
    returnHeaders: true,
  })) as unknown as Response;
  const { user } = (await res.json()) as {
    user: { id: string; email: string };
  };
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("signup did not set a session cookie");
  return { user, headers: new Headers({ cookie }) };
}

/** Simulate clicking the verification link (captured signed token). */
async function verifyEmail(email: string) {
  const mails = takeCapturedMails().filter((m) => m.to === email);
  if (mails.length === 0) throw new Error(`no verification mail for ${email}`);
  const token = mails[mails.length - 1]!.token;
  if (!token) throw new Error("verification mail has no token");
  const result = (await getAuth().api.verifyEmail({ query: { token } })) as {
    status: boolean;
  };
  expect(result.status).toBe(true);
}

/** Read the two verification flags straight from the platform `user` table (owner role). */
async function readFlags(email: string): Promise<{
  id: string;
  manuallyApproved: boolean;
  emailVerified: boolean;
}> {
  const { rows } = await admin.query(
    `SELECT id, manually_approved, email_verified FROM "user" WHERE email = $1`,
    [email],
  );
  const r = rows[0];
  if (!r) throw new Error(`user row not found: ${email}`);
  return {
    id: String(r.id),
    manuallyApproved: !!r.manually_approved,
    emailVerified: !!r.email_verified,
  };
}

/**
 * Derive an operator identity EXACTLY as the script does: from a VERIFIED token,
 * never a literal. The returned sub is the verified operator's real identifier.
 */
function verifiedOperatorId(sub: string): string {
  const token = issueOperatorToken(OPERATOR_SECRET, sub);
  return verifyOperatorToken(token, OPERATOR_SECRET).sub;
}

function scriptEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AUTH_DATABASE_URL: ADMIN_URL,
    DATABASE_URL: APP_URL,
    BETTER_AUTH_SECRET: TEST_SECRET,
    OPERATOR_TOKEN: undefined,
    OPERATOR_TOKEN_SECRET: OPERATOR_SECRET,
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

async function runScript(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await pexecFile(
      process.execPath,
      ["--import", "tsx", "scripts/manual-approval.mts", ...args],
      { env, cwd: REPO_ROOT, timeout: 60_000 },
    );
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

/** Run any `scripts/*.mts` with a given env (operator-token issuance/revocation). */
async function runMts(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await pexecFile(
      process.execPath,
      ["--import", "tsx", `scripts/${script}`, ...args],
      { env, cwd: REPO_ROOT, timeout: 90_000 },
    );
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

/** Env for the operator-token script (needs full app env + operator session). */
function operatorTokenEnv(
  cookie: string | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AUTH_DATABASE_URL: ADMIN_URL,
    DATABASE_URL: APP_URL,
    BETTER_AUTH_SECRET: TEST_SECRET,
    BETTER_AUTH_URL: "http://localhost:3000",
    OPERATOR_TOKEN_SECRET: OPERATOR_SECRET,
    PLATFORM_OPERATOR_EMAILS: "ops@vanny.cd",
  };
  if (cookie === undefined) delete env.OPERATOR_SESSION_COOKIE;
  else env.OPERATOR_SESSION_COOKIE = cookie;
  return env;
}

/** Extract the jti from operator-token.mts "ISSUED ..." output. */
function extractJti(text: string): string {
  const m = /jti=([\w-]+)/.exec(text);
  const jti = m?.[1];
  if (!jti) throw new Error("could not extract jti from output");
  return jti;
}

/** Sign in and return the session headers (for operator issuance). */
async function operatorSession(email: string): Promise<string> {
  const res = (await getAuth().api.signInEmail({
    body: { email, password: "S3cure!pass" },
    asResponse: true,
    returnHeaders: true,
  })) as unknown as Response;
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("sign-in did not set a session cookie");
  return cookie;
}

beforeAll(async () => {
  admin = await startPostgres("approvals");
  // Swallow the 57P01 (server-shutdown) notice on idle clients during teardown;
  // this is a teardown artifact, not a test failure.
  admin.on("error", () => {});
  process.env.DATABASE_URL = APP_URL; // tenant role (RLS-enforced)
  process.env.AUTH_DATABASE_URL = ADMIN_URL; // owner role (Better Auth)
  process.env.BETTER_AUTH_SECRET = TEST_SECRET;
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  // ADR-0014: email delivery DISABLED (no Resend key present, transport "none").
  process.env.MAIL_TRANSPORT = "none";
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  void getAuth();
}, 180_000);

afterAll(async () => {
  await closeAuthDb().catch(() => {});
  await closeTenantPool().catch(() => {});
  resetAuth();
  if (admin) await stopPostgres(admin);
});

// ---------------------------------------------------------------------------

describe("ADR-0014 — no-Resend operation (email transport disabled)", () => {
  it("authorized sign-up, sign-in, and session all work with NO network call", async () => {
    const spy = vi.fn(async () => {
      throw new Error("no network is allowed in this test");
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = spy as unknown as typeof fetch;
    try {
      const { user, headers } = await signup(
        "No Resend",
        "noresend@example.cd",
      );
      expect(user.email).toBe("noresend@example.cd");
      // The mail was NOT delivered, so the email is NOT verified.
      expect((await readFlags("noresend@example.cd")).emailVerified).toBe(false);

      // Available auth flow: sign-in works without any email.
      const si = (await getAuth().api.signInEmail({
        body: { email: "noresend@example.cd", password: "S3cure!pass" },
        asResponse: true,
        returnHeaders: true,
      })) as unknown as Response;
      const siJson = (await si.json()) as { user?: { email: string } };
      expect(siJson.user?.email).toBe("noresend@example.cd");

      // Session works.
      const session = await getAuth().api.getSession({ headers });
      expect(session?.user?.email).toBe("noresend@example.cd");

      // No Resend (or any) network call was made.
      expect(spy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// ---------------------------------------------------------------------------

describe("ADR-0014 — manual approval is distinct from email verification", () => {
  it("approving a user sets manually_approved WITHOUT touching email_verified", async () => {
    const { user } = await signup("Eve Approved", "eve-approved@example.cd");
    const before = await readFlags("eve-approved@example.cd");
    expect(before.emailVerified).toBe(false);
    expect(before.manuallyApproved).toBe(false);

    await applyManualApproval({
      operatorId: verifiedOperatorId("operator-eve"),
      userEmail: "eve-approved@example.cd",
      action: "approve",
      reason: "identity confirmed via WhatsApp call (test)",
    });

    const after = await readFlags("eve-approved@example.cd");
    expect(after.manuallyApproved).toBe(true);
    expect(after.emailVerified).toBe(false); // approval NEVER verifies the email

    // A single append-only audit row, written in the same transaction.
    const audit = await admin.query(
      `SELECT operator_id, action, reason, operation_id FROM manual_approvals
       WHERE user_id = $1`,
      [user.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].operator_id).toBe("operator-eve");
    expect(audit.rows[0].action).toBe("approve");
    expect(audit.rows[0].reason).toMatch(/WhatsApp/);
    expect(audit.rows[0].operation_id).toBeTruthy();
  });

  it("a revocation is recorded and clears the flag (history preserved)", async () => {
    const { user } = await signup("Rita Revoke", "rita-revoke@example.cd");
    await applyManualApproval({
      operatorId: verifiedOperatorId("operator-rita"),
      userEmail: "rita-revoke@example.cd",
      action: "approve",
      reason: "approve (test)",
    });
    expect((await readFlags("rita-revoke@example.cd")).manuallyApproved).toBe(true);

    await applyManualApproval({
      operatorId: verifiedOperatorId("operator-rita"),
      userEmail: "rita-revoke@example.cd",
      action: "revoke",
      reason: "revoked (test)",
    });
    const after = await readFlags("rita-revoke@example.cd");
    expect(after.manuallyApproved).toBe(false);
    expect(after.emailVerified).toBe(false);

    // Both operations remain in the append-only ledger.
    const audit = await admin.query(
      `SELECT action FROM manual_approvals WHERE user_id = $1 ORDER BY created_at`,
      [user.id],
    );
    expect(audit.rows.map((r: { action: string }) => r.action)).toEqual([
      "approve",
      "revoke",
    ]);
  });

  it("fails closed without a reason, a verified operator, or a known user", async () => {
    await signup("No Reason", "noreason@example.cd");
    await expect(
      applyManualApproval({
        operatorId: verifiedOperatorId("op"),
        userEmail: "noreason@example.cd",
        action: "approve",
        reason: "   ",
      }),
    ).rejects.toThrow(/reason/);
    await expect(
      applyManualApproval({
        operatorId: "",
        userEmail: "noreason@example.cd",
        action: "approve",
        reason: "x",
      }),
    ).rejects.toThrow(/operatorId/);
    await expect(
      applyManualApproval({
        operatorId: verifiedOperatorId("op"),
        userEmail: "ghost@example.cd",
        action: "approve",
        reason: "x",
      }),
    ).rejects.toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------

describe("ADR-0014 — secure invitation adaptation", () => {
  let alice: Awaited<ReturnType<typeof signup>>;
  let orgAId: string;
  let branchAId: string;
  let carol: Awaited<ReturnType<typeof signup>>;
  let orgBId: string;
  let branchBId: string;

  beforeAll(async () => {
    alice = await signup("Alice Owner", "alice-a14@example.cd");
    await verifyEmail("alice-a14@example.cd");
    const orgA = await runOnboarding(alice.headers, {
      name: "Bar Alpha",
      slug: "bar-alpha",
      sector: "bar",
      baseCurrency: "CDF",
      firstBranchName: "Centre",
    });
    orgAId = orgA.orgId;
    branchAId = orgA.branchId;

    carol = await signup("Carol Owner", "carol-a14@example.cd");
    await verifyEmail("carol-a14@example.cd");
    const orgB = await runOnboarding(carol.headers, {
      name: "Bar Oméga",
      slug: "bar-omega",
      sector: "bar",
      baseCurrency: "CDF",
      firstBranchName: "Matonge",
    });
    orgBId = orgB.orgId;
    branchBId = orgB.branchId;
  });

  it("an unverified, unapproved user is refused; after approval they accept their OWN invitation", async () => {
    const inv = await inviteMember(alice.headers, {
      email: "eve@example.cd",
      role: "cashier",
      branchIds: [branchAId],
    });

    const eve = await signup("Eve Invitee", "eve@example.cd");

    // Unverified + unapproved → refused by our ADR-0014 gate.
    await expect(
      acceptInvitation(eve.headers, { invitationId: inv.invitationId }),
    ).rejects.toThrow(/verified or manually approved/i);

    // Manual approval (identity from a verified token) — email still unverified.
    await applyManualApproval({
      operatorId: verifiedOperatorId("operator-eve"),
      userEmail: "eve@example.cd",
      action: "approve",
      reason: "identity confirmed via WhatsApp call (test)",
    });
    expect((await readFlags("eve@example.cd")).emailVerified).toBe(false);

    // Now she accepts her own invitation.
    await acceptInvitation(eve.headers, { invitationId: inv.invitationId });

    // She is a member of org A; her email is STILL unverified.
    const mem = await admin.query(
      `SELECT role FROM member WHERE organization_id = $1 AND user_id = $2`,
      [orgAId, eve.user.id],
    );
    expect(mem.rows).toHaveLength(1);
    expect(mem.rows[0].role).toBe("cashier");
    expect((await readFlags("eve@example.cd")).emailVerified).toBe(false);
  });

  it("a manually-approved user still CANNOT view the invitation list (list stays strict)", async () => {
    // Manually approved but email NOT verified → list-user-invitations remains
    // hard-gated on emailVerified (owner condition). Acceptance works via the
    // direct secure link, but the LIST does not.
    const lc = await signup("List Check", "listcheck@example.cd");
    await applyManualApproval({
      operatorId: verifiedOperatorId("operator-list"),
      userEmail: "listcheck@example.cd",
      action: "approve",
      reason: "identity confirmed via WhatsApp call (test)",
    });
    expect((await readFlags("listcheck@example.cd")).emailVerified).toBe(false);
    await expect(myInvitations(lc.headers)).rejects.toThrow(/verification/i);
  });

  it("FINAL GUARDRAIL: a manually-approved user CANNOT accept ANOTHER org's invitation", async () => {
    // Grace is manually approved (email unverified). She has NO relationship to
    // org B. Carol (org B) invited mallory (a DIFFERENT email), not grace.
    const grace = await signup("Grace Guard", "grace@example.cd");
    await applyManualApproval({
      operatorId: verifiedOperatorId("operator-grace"),
      userEmail: "grace@example.cd",
      action: "approve",
      reason: "identity confirmed via WhatsApp call (test)",
    });
    expect((await readFlags("grace@example.cd")).emailVerified).toBe(false);

    const orgBInv = await inviteMember(carol.headers, {
      email: "mallory@example.cd",
      role: "cashier",
      branchIds: [branchBId],
    });

    // Grace tries to accept org B's invitation (not addressed to her).
    let rejected = false;
    try {
      await acceptInvitation(grace.headers, {
        invitationId: orgBInv.invitationId,
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);

    // No membership in org B, no branch access in org B.
    const mem = await admin.query(
      `SELECT 1 FROM member WHERE organization_id = $1 AND user_id = $2`,
      [orgBId, grace.user.id],
    );
    expect(mem.rows).toHaveLength(0);
    const ba = await admin.query(
      `SELECT 1 FROM branch_access WHERE org_id = $1 AND user_id = $2`,
      [orgBId, grace.user.id],
    );
    expect(ba.rows).toHaveLength(0);

    // The invitation is still pending (unchanged by the attempt).
    const st = await admin.query(
      `SELECT status FROM invitation WHERE id = $1`,
      [orgBInv.invitationId],
    );
    expect(st.rows[0].status).toBe("pending");

    // RBAC ground truth: grace has no standing in org B.
    expect(await readFlags("grace@example.cd")).toEqual(
      expect.objectContaining({ emailVerified: false, manuallyApproved: true }),
    );
  });
});

// ---------------------------------------------------------------------------

describe("ADR-0014 — audited operator script (identity from a verified token)", () => {
  it("succeeds with a valid operator token and writes the audit row", async () => {
    await signup("Script User", "scriptuser@example.cd");
    const goodToken = issueOperatorToken(OPERATOR_SECRET, "operator-cli");

    const res = await runScript(
      [
        "--user",
        "scriptuser@example.cd",
        "--action",
        "approve",
        "--reason",
        "identity confirmed via WhatsApp call 2026-11-25",
      ],
      scriptEnv({ OPERATOR_TOKEN: goodToken }),
    );
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/operator=operator-cli/);
    expect(res.stdout).toMatch(/manually_approved=true/);
    expect(res.stdout).toMatch(/operation_id=/);

    const audit = await admin.query(
      `SELECT operator_id, action, reason FROM manual_approvals
       WHERE user_id = (SELECT id FROM "user" WHERE email = 'scriptuser@example.cd')`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].operator_id).toBe("operator-cli");
    expect(audit.rows[0].action).toBe("approve");
  });

  it("FAILS CLOSED with a forged token (identity never trusted from an argument)", async () => {
    await signup("Forged Target", "forged@example.cd");
    // A token signed with the WRONG secret: the script must reject it.
    const forgedToken = issueOperatorToken("WRONG_SECRET_NOT_TRUSTED", "operator-cli");

    const res = await runScript(
      [
        "--user",
        "forged@example.cd",
        "--action",
        "approve",
        "--reason",
        "should be rejected",
      ],
      scriptEnv({ OPERATOR_TOKEN: forgedToken }),
    );
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/verification failed/);

    // No approval was applied, no audit row written.
    expect((await readFlags("forged@example.cd")).manuallyApproved).toBe(false);
    const audit = await admin.query(
      `SELECT 1 FROM manual_approvals
       WHERE user_id = (SELECT id FROM "user" WHERE email = 'forged@example.cd')`,
    );
    expect(audit.rows).toHaveLength(0);
  });

  it("refuses to run without an operator token (no identity fallback)", async () => {
    const res = await runScript(
      [
        "--user",
        "forged@example.cd",
        "--action",
        "approve",
        "--reason",
        "no token",
      ],
      scriptEnv({ OPERATOR_TOKEN: undefined }),
    );
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/OPERATOR_TOKEN/);
  });
});

// ---------------------------------------------------------------------------

describe("ADR-0014 — Resend regression (re-enabling delivery still works)", () => {
  it("with MAIL_TRANSPORT=resend, sign-up delivers via the Resend API", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ id: "r1" }), { status: 202 }));
    const realFetch = globalThis.fetch;
    const savedTransport = process.env.MAIL_TRANSPORT;
    const savedKey = process.env.RESEND_API_KEY;
    const savedFrom = process.env.RESEND_FROM;
    globalThis.fetch = spy as unknown as typeof fetch;
    process.env.MAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM = "Vanny <no-reply@vanny.cd>";
    try {
      await signup("Resend Again", "resend-regression@example.cd");
      expect(spy).toHaveBeenCalledTimes(1);
      const call = spy.mock.calls[0];
      const [url, init] = (call ?? []) as unknown as [string, RequestInit];
      expect(url).toBe("https://api.resend.com/emails");
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer re_test_key",
      );
    } finally {
      globalThis.fetch = realFetch;
      process.env.MAIL_TRANSPORT = savedTransport;
      if (savedKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = savedKey;
      if (savedFrom === undefined) delete process.env.RESEND_FROM;
      else process.env.RESEND_FROM = savedFrom;
    }
  });
});

// ---------------------------------------------------------------------------

describe("ADR-0014 — append-only audit enforcement (demonstration)", () => {
  it("app role CANNOT update/delete/drop manual_approvals; even the owner's row-writes are blocked by the trigger", async () => {
    // Seed a user + a legitimate approval row (owner, via the service).
    await signup("Audit Guard", "auditguard@example.cd");
    await applyManualApproval({
      operatorId: verifiedOperatorId("operator-audit"),
      userEmail: "auditguard@example.cd",
      action: "approve",
      reason: "demonstrate append-only",
    });
    const { rows } = await admin.query(
      `SELECT id FROM manual_approvals
       WHERE user_id = (SELECT id FROM "user" WHERE email = 'auditguard@example.cd')`,
    );
    const rowId = rows[0].id;
    expect(rowId).toBeTruthy();

    let upd = "";
    let del = "";
    let drop = "";
    let ownerUpd = "";
    let ownerDel = "";

    // Connect AS THE APPLICATION ROLE (tenant_app) — RLS role, not the owner.
    const app = new Pool({ connectionString: APP_URL, max: 2 });
    // Swallow idle-client notices from server shutdown during teardown (57P01);
    // query errors are handled explicitly in the try/catch below.
    app.on("error", () => {});
    try {
      try {
        await app.query(`UPDATE manual_approvals SET reason = 'tampered' WHERE id = $1`, [rowId]);
        upd = "NO ERROR (BAD)";
      } catch (e) {
        upd = (e as Error).message;
      }
      expect(upd).toMatch(/append-only/);

      try {
        await app.query(`DELETE FROM manual_approvals WHERE id = $1`, [rowId]);
        del = "NO ERROR (BAD)";
      } catch (e) {
        del = (e as Error).message;
      }
      expect(del).toMatch(/append-only/);

      // The app role cannot drop the trigger (not the table owner, no DDL grant).
      try {
        await app.query(`DROP TRIGGER manual_approvals_append_only ON manual_approvals`);
        drop = "NO ERROR (BAD)";
      } catch (e) {
        drop = (e as Error).message;
      }
      expect(drop).not.toContain("NO ERROR");
      expect(drop).toMatch(/must be owner|permission denied/i);

      // Row is intact after the failed attempts.
      const still = await admin.query(
        `SELECT 1 FROM manual_approvals WHERE id = $1`,
        [rowId],
      );
      expect(still.rows).toHaveLength(1);
    } finally {
      await app.end();
    }

    // Even the OWNER (postgres) cannot UPDATE/DELETE rows — the trigger fires for
    // every role. Only DDL (dropping the trigger) bypasses it, which is the
    // trusted DBA/migration boundary (the root of trust), not an app capability.
    try {
      await admin.query(`UPDATE manual_approvals SET reason = 'tampered' WHERE id = $1`, [rowId]);
      ownerUpd = "NO ERROR (BAD)";
    } catch (e) {
      ownerUpd = (e as Error).message;
    }
    expect(ownerUpd).toMatch(/append-only/);
    try {
      await admin.query(`DELETE FROM manual_approvals WHERE id = $1`, [rowId]);
      ownerDel = "NO ERROR (BAD)";
    } catch (e) {
      ownerDel = (e as Error).message;
    }
    expect(ownerDel).toMatch(/append-only/);

    // Surface the raw DB error text as executed proof.
    console.log(`[append-only] APP   UPDATE -> ${upd.replace(/\s+/g, " ")}`);
    console.log(`[append-only] APP   DELETE -> ${del.replace(/\s+/g, " ")}`);
    console.log(`[append-only] APP   DROP   -> ${drop.replace(/\s+/g, " ")}`);
    console.log(`[append-only] OWNER UPDATE -> ${ownerUpd.replace(/\s+/g, " ")}`);
    console.log(`[append-only] OWNER DELETE -> ${ownerDel.replace(/\s+/g, " ")}`);

    // The audit row survives every attempt.
    const final = await admin.query(
      `SELECT count(*)::int AS n FROM manual_approvals WHERE id = $1`,
      [rowId],
    );
    expect(final.rows[0].n).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("ADR-0014 (CTO hardening) — operator token issuance / revocation / expiration", () => {
  let opUserId: string;

  beforeAll(async () => {
    const op = await signup("Ops Person", "ops@vanny.cd");
    opUserId = op.user.id;
    await signup("Outsider", "outsider@x.cd");
  });

  it("issues a 15-min token from an AUTHENTICATED+AUTHORIZED session; sub = session user id; audited", async () => {
    const cookie = await operatorSession("ops@vanny.cd");
    const res = await runMts(
      "operator-token.mts",
      ["issue"],
      operatorTokenEnv(cookie),
    );
    expect(res.code).toBe(0);
    const lines = res.stdout.trim().split("\n");
    const token = lines[lines.length - 1]!;
    const issued = lines.find((l) => l.startsWith("ISSUED"))!;
    expect(issued).toMatch(/ttl=900s/);
    expect(issued).toContain(`sub=${opUserId}`); // sub = authenticated session user id
    const jti = extractJti(issued);
    const id = verifyOperatorToken(token, OPERATOR_SECRET);
    expect(id.sub).toBe(opUserId);
    expect(id.jti).toBe(jti);
    // Issuance audited in the append-only ledger.
    const iss = await admin.query(
      `SELECT operator_sub, operator_email, ttl_seconds FROM operator_token_issuances WHERE jti = $1`,
      [jti],
    );
    expect(iss.rows).toHaveLength(1);
    expect(iss.rows[0].operator_sub).toBe(opUserId);
    expect(iss.rows[0].operator_email).toBe("ops@vanny.cd");
    expect(iss.rows[0].ttl_seconds).toBe(900);
  });

  it("REFUSES issuance for a non-authorized session (email not in the allowlist)", async () => {
    const cookie = await operatorSession("outsider@x.cd");
    const res = await runMts(
      "operator-token.mts",
      ["issue"],
      operatorTokenEnv(cookie),
    );
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/not an authorized platform operator/i);
    const iss = await admin.query(
      `SELECT 1 FROM operator_token_issuances WHERE operator_email = 'outsider@x.cd'`,
    );
    expect(iss.rows).toHaveLength(0);
  });

  it("REFUSES issuance without an authenticated session (no cookie)", async () => {
    const res = await runMts(
      "operator-token.mts",
      ["issue"],
      operatorTokenEnv(undefined),
    );
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/OPERATOR_SESSION_COOKIE|authenticated session/i);
  });

  it("revocation is enforced on EVERY use: a revoked jti makes manual-approval FAIL CLOSED", async () => {
    await signup("Rev Target", "rev-target@example.cd");
    const cookie = await operatorSession("ops@vanny.cd");
    const res = await runMts(
      "operator-token.mts",
      ["issue"],
      operatorTokenEnv(cookie),
    );
    const token = res.stdout.trim().split("\n").pop()!;
    const jti = extractJti(res.stdout);

    // Use #1: approve (token still valid) — succeeds.
    const r1 = await runScript(
      [
        "--user",
        "rev-target@example.cd",
        "--action",
        "approve",
        "--reason",
        "first use",
      ],
      scriptEnv({ OPERATOR_TOKEN: token }),
    );
    expect(r1.code).toBe(0);

    // Revoke the jti (authenticated operator session + mandatory reason).
    const rev = await runMts(
      "operator-token.mts",
      [
        "revoke",
        "--jti",
        jti,
        "--reason",
        "token rotated after suspected exposure",
      ],
      operatorTokenEnv(cookie),
    );
    expect(rev.code).toBe(0);

    // Use #2: the SAME token, now revoked — FAILS CLOSED.
    const r2 = await runScript(
      [
        "--user",
        "rev-target@example.cd",
        "--action",
        "revoke",
        "--reason",
        "second use",
      ],
      scriptEnv({ OPERATOR_TOKEN: token }),
    );
    expect(r2.code).not.toBe(0);
    expect(r2.stderr).toMatch(/revoked/i);

    // Revocation audited (append-only).
    const rov = await admin.query(
      `SELECT revoker_sub, reason FROM operator_token_revocations WHERE jti = $1`,
      [jti],
    );
    expect(rov.rows).toHaveLength(1);
    expect(rov.rows[0].revoker_sub).toBe(opUserId);
  }, 30_000);

  it("an EXPIRED token FAILS CLOSED (15-minute life)", async () => {
    await signup("Exp Target", "exp-target@example.cd");
    const cookie = await operatorSession("ops@vanny.cd");
    const res = await runMts(
      "operator-token.mts",
      ["issue", "--ttl", "0"],
      operatorTokenEnv(cookie),
    );
    const token = res.stdout.trim().split("\n").pop()!;
    const r = await runScript(
      [
        "--user",
        "exp-target@example.cd",
        "--action",
        "approve",
        "--reason",
        "expired token",
      ],
      scriptEnv({ OPERATOR_TOKEN: token }),
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/expired/i);
  });
});

// ---------------------------------------------------------------------------

describe("ADR-0014 — permission isolation & approval-revocation effect", () => {
  let owner: Awaited<ReturnType<typeof signup>>;
  let orgId: string;
  let branchId: string;

  beforeAll(async () => {
    owner = await signup("Owner Perm", "owner-perm@example.cd");
    await verifyEmail("owner-perm@example.cd");
    const org = await runOnboarding(owner.headers, {
      name: "Bar Perm",
      slug: "bar-perm",
      sector: "bar",
      baseCurrency: "CDF",
      firstBranchName: "Centre",
    });
    orgId = org.orgId;
    branchId = org.branchId;
  });

  it("unverified + unapproved user (invited, pending) has NO access to protected business functions", async () => {
    const inv = await inviteMember(owner.headers, {
      email: "eve-isolated@example.cd",
      role: "cashier",
      branchIds: [branchId],
    });
    const eve = await signup("Eve Isolated", "eve-isolated@example.cd");

    // 1) No active organization → business endpoints are refused (401/403).
    await expect(listBranches(eve.headers)).rejects.toThrow();
    await expect(listMembers(eve.headers)).rejects.toThrow();

    // 2) Not a member of the org → RBAC denies (NOT_A_MEMBER).
    await expect(
      withTenantDb(orgId, (db) =>
        authorize(db, { userId: eve.user.id, permission: "cash.view" }),
      ),
    ).rejects.toMatchObject({ reason: "NOT_A_MEMBER" });

    // 3) Invitation list is strict (unverified) — 403.
    await expect(myInvitations(eve.headers)).rejects.toThrow(/verification/i);

    // 4) Cannot accept (not verified, not approved).
    await expect(
      acceptInvitation(eve.headers, { invitationId: inv.invitationId }),
    ).rejects.toThrow(/verified or manually approved/i);
  });

  it("revoking an approval does NOT auto-log-out the user or remove their membership", async () => {
    const inv = await inviteMember(owner.headers, {
      email: "eve-revoked@example.cd",
      role: "cashier",
      branchIds: [branchId],
    });
    const eve = await signup("Eve Revoked", "eve-revoked@example.cd");
    await applyManualApproval({
      operatorId: verifiedOperatorId("operator-rev"),
      userEmail: "eve-revoked@example.cd",
      action: "approve",
      reason: "approve (test)",
    });
    await acceptInvitation(eve.headers, { invitationId: inv.invitationId });

    // Active session + membership established.
    const s1 = await getAuth().api.getSession({ headers: eve.headers });
    expect(s1?.user?.id).toBe(eve.user.id);
    const m1 = await admin.query(
      `SELECT role FROM member WHERE organization_id = $1 AND user_id = $2`,
      [orgId, eve.user.id],
    );
    expect(m1.rows).toHaveLength(1);

    // Revoke the approval.
    await applyManualApproval({
      operatorId: verifiedOperatorId("operator-rev"),
      userEmail: "eve-revoked@example.cd",
      action: "revoke",
      reason: "revoked (test)",
    });
    expect((await readFlags("eve-revoked@example.cd")).manuallyApproved).toBe(false);

    // EFFECT: the session is STILL active and the membership STILL exists.
    // (Approval revocation is a verification-status change, NOT a session/member
    //  revocation — removing a member/session is a separate RBAC-controlled action.)
    const s2 = await getAuth().api.getSession({ headers: eve.headers });
    expect(s2?.user?.id).toBe(eve.user.id);
    const m2 = await admin.query(
      `SELECT role FROM member WHERE organization_id = $1 AND user_id = $2`,
      [orgId, eve.user.id],
    );
    expect(m2.rows).toHaveLength(1);
  });

  it("revocation reverts the acceptance gate: an approved-then-revoked user can no longer accept", async () => {
    const inv = await inviteMember(owner.headers, {
      email: "eve-blocked@example.cd",
      role: "cashier",
      branchIds: [branchId],
    });
    const eve = await signup("Eve Blocked", "eve-blocked@example.cd");
    // Approve, then revoke BEFORE accepting (user is not yet a member).
    await applyManualApproval({
      operatorId: verifiedOperatorId("operator-rev"),
      userEmail: "eve-blocked@example.cd",
      action: "approve",
      reason: "approve (test)",
    });
    await applyManualApproval({
      operatorId: verifiedOperatorId("operator-rev"),
      userEmail: "eve-blocked@example.cd",
      action: "revoke",
      reason: "revoked (test)",
    });
    expect((await readFlags("eve-blocked@example.cd")).manuallyApproved).toBe(false);
    // Now unverified + unapproved → the pending invitation can no longer be accepted.
    await expect(
      acceptInvitation(eve.headers, { invitationId: inv.invitationId }),
    ).rejects.toThrow(/verified or manually approved/i);
  });

  it("revoking an approval IMMEDIATELY blocks sensitive ops on an active session (membership/session intact)", async () => {
    const inv = await inviteMember(owner.headers, {
      email: "eve-live@example.cd",
      role: "cashier",
      branchIds: [branchId],
    });
    const eve = await signup("Eve Live", "eve-live@example.cd");
    await applyManualApproval({
      operatorId: verifiedOperatorId("operator-live"),
      userEmail: "eve-live@example.cd",
      action: "approve",
      reason: "approve (test)",
    });
    await acceptInvitation(eve.headers, { invitationId: inv.invitationId });

    // While approved: a sensitive, branch-scoped operation succeeds (server-side check).
    const role = await withTenantDb(orgId, (db) =>
      authorize(db, { userId: eve.user.id, permission: "cash.open", branchId }),
    );
    expect(role).toBe("cashier");

    // Revoke the approval (session + membership deliberately NOT touched).
    await applyManualApproval({
      operatorId: verifiedOperatorId("operator-live"),
      userEmail: "eve-live@example.cd",
      action: "revoke",
      reason: "revoked (test)",
    });
    expect((await readFlags("eve-live@example.cd")).manuallyApproved).toBe(false);

    // The VERY NEXT sensitive operation is blocked immediately (active session).
    await expect(
      withTenantDb(orgId, (db) =>
        authorize(db, { userId: eve.user.id, permission: "cash.open", branchId }),
      ),
    ).rejects.toMatchObject({ reason: "APPROVAL_REVOKED", status: 403 });

    // Membership and session are INTACT (removal is a separate, deliberate action).
    const mem = await admin.query(
      `SELECT role FROM member WHERE organization_id = $1 AND user_id = $2`,
      [orgId, eve.user.id],
    );
    expect(mem.rows).toHaveLength(1);
    const s = await getAuth().api.getSession({ headers: eve.headers });
    expect(s?.user?.id).toBe(eve.user.id);
  });

  it("an unverified OWNER (onboarded, not approved) is NOT blocked (onboarding carve-out)", async () => {
    const ou = await signup("Owner Unverified", "owner-unverified@example.cd");
    // Do NOT verify, do NOT approve. Onboarding is not verification-gated.
    const orgU = await runOnboarding(ou.headers, {
      name: "Bar Unverified",
      slug: "bar-unverified",
      sector: "bar",
      baseCurrency: "CDF",
      firstBranchName: "Centre",
    });
    expect((await readFlags("owner-unverified@example.cd")).manuallyApproved).toBe(false);
    // Owner's sensitive operation succeeds without approval (owner is exempt).
    const role = await withTenantDb(orgU.orgId, (db) =>
      authorize(db, { userId: ou.user.id, permission: "org.settings.manage" }),
    );
    expect(role).toBe("owner");
  });
});
