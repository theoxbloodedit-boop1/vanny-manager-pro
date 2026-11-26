import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { Pool } from "pg";
import { urlsFor, startPostgres, stopPostgres } from "./pg-harness";
import { getAuth, resetAuth } from "../../src/auth";
import { closeAuthDb } from "../../src/auth/db";
import { closeTenantPool } from "../../src/db/tenant";
import { getMe } from "../../src/server/me";
import { runOnboarding } from "../../src/server/onboarding";
import {
  listPhoneApprovals,
  operatorApplyApproval,
  signInByPhone,
  signUpByPhone,
} from "../../src/server/phone-auth";
import { takeCapturedMails } from "../../src/server/email";
import { PHONE_VIRTUAL_DOMAIN } from "../../src/server/phone";

/**
 * ADR-0016 — PHONE (WHATSAPP) SIGN-UP + OPERATOR APPROVAL, end-to-end on the
 * real stack: phone sign-up → INERT account → onboarding refused (server
 * gate) → operator approval (audited, atomic) → onboarding succeeds.
 *
 * Security properties asserted:
 *   - the virtual email is never delivered (mail choke point skips it);
 *   - unapproved phone accounts cannot onboard (403 VERIFICATION_REQUIRED);
 *   - an UNVERIFIED EMAIL account cannot onboard either (gate fix — before
 *     this ADR the gate existed only in the client);
 *   - the operator endpoints refuse non-operators (403, fail-closed);
 *   - the approval writes the append-only audit row (operator = real session
 *     user id, mandatory reason);
 *   - duplicate phone → 409; sign-in by phone works;
 *   - the email sign-up surface rejects the reserved virtual domain.
 */

const TEST_SECRET = "phone-integration-secret-not-for-prod-0123456789abcdef";
const OPERATOR_EMAIL = "vanny-operator@vanny.test";

let admin: Pool;

/** Phone sign-up through the SERVICE (the route forwards its Response). */
async function phoneSignup(name: string, phone: string) {
  const res = await signUpByPhone({ name, phone, password: "S3cure!pass" });
  const cookie = res.headers.getSetCookie()[0]?.split(";")[0];
  if (!cookie) throw new Error("phone signup did not set a session cookie");
  return { headers: new Headers({ cookie }) };
}

/** Stock email sign-up (better-auth), cookie-carrying, like a browser. */
async function emailSignup(name: string, email: string) {
  const res = (await getAuth().api.signUpEmail({
    body: { name, email, password: "S3cure!pass" },
    asResponse: true,
    returnHeaders: true,
  })) as unknown as Response;
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("email signup did not set a session cookie");
  return { headers: new Headers({ cookie }) };
}

const { APP_URL, ADMIN_URL } = urlsFor("phone");

beforeAll(async () => {
  admin = await startPostgres("phone");
  process.env.DATABASE_URL = APP_URL;
  process.env.AUTH_DATABASE_URL = ADMIN_URL;
  process.env.BETTER_AUTH_SECRET = TEST_SECRET;
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.MAIL_TRANSPORT = "capture";
  process.env.PLATFORM_OPERATOR_EMAILS = OPERATOR_EMAIL;
  void getAuth();
}, 180_000);

afterAll(async () => {
  await closeAuthDb().catch(() => {});
  await closeTenantPool().catch(() => {});
  resetAuth();
  if (admin) await stopPostgres(admin);
});

// ---------------------------------------------------------------------------

describe("phone sign-up journey (ADR-0016)", () => {
  const phone = "0971234567";
  let client: Awaited<ReturnType<typeof phoneSignup>>;
  let operator: Awaited<ReturnType<typeof emailSignup>>;

  it("creates the account: session cookie + phone stored + virtual email", async () => {
    client = await phoneSignup("Maman Adjo", phone);

    const me = await getMe(client.headers);
    expect(me.authenticated).toBe(true);
    expect(me.user?.phone).toBe("+243971234567");
    expect(me.user?.email).toBe(`243971234567@${PHONE_VIRTUAL_DOMAIN}`);
    expect(me.user?.emailVerified).toBe(false);
    expect(me.user?.manuallyApproved).toBe(false);
    expect(me.organization).toBeNull();
  });

  it("never records or sends a verification mail for the virtual email", () => {
    const mails = takeCapturedMails();
    expect(
      mails.filter((m) => m.to.endsWith(`@${PHONE_VIRTUAL_DOMAIN}`)),
    ).toHaveLength(0);
  });

  it("refuses onboarding while unapproved (SERVER gate, 403)", async () => {
    await expect(
      runOnboarding(client.headers, {
        name: "Boutique Maman",
        slug: "boutique-maman",
        sector: "boutique",
        baseCurrency: "USD",
        firstBranchName: "Marché",
      }),
    ).rejects.toMatchObject({ code: "VERIFICATION_REQUIRED", status: 403 });
  });

  it("an UNVERIFIED EMAIL account is also refused onboarding (gate fix)", async () => {
    const emailUser = await emailSignup("Jean Email", "jean-unverified@example.cd");
    await expect(
      runOnboarding(emailUser.headers, {
        name: "Société Jean",
        slug: "societe-jean",
        sector: "bar",
        baseCurrency: "CDF",
        firstBranchName: "X",
      }),
    ).rejects.toMatchObject({ code: "VERIFICATION_REQUIRED", status: 403 });
  });

  it("a non-operator cannot list nor approve (403, fail-closed)", async () => {
    const stranger = await emailSignup("Intrus", "intrus@example.cd");
    await expect(listPhoneApprovals(stranger.headers)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      operatorApplyApproval(stranger.headers, {
        phone,
        action: "approve",
        reason: "je veux bien",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("the operator sees the pending phone sign-up", async () => {
    operator = await emailSignup("Vanny Operator", OPERATOR_EMAIL);
    const { pending } = await listPhoneApprovals(operator.headers);
    expect(pending.map((p) => p.phone)).toContain("+243971234567");
    const row = pending.find((p) => p.phone === "+243971234567")!;
    expect(row.name).toBe("Maman Adjo");
  });

  it("approves (one click) — atomic flag + append-only audit row", async () => {
    const result = await operatorApplyApproval(operator.headers, {
      phone,
      action: "approve",
      reason: "Identité confirmée par WhatsApp",
    });
    expect(result.manuallyApproved).toBe(true);
    expect(result.operationId).toBeTruthy();

    const me = await getMe(client.headers);
    expect(me.user?.manuallyApproved).toBe(true);
    // Approval NEVER implies emailVerified.
    expect(me.user?.emailVerified).toBe(false);

    // Ground truth as the owner role (bypasses RLS):
    const c = await admin.connect();
    try {
      const audit = await c.query(
        `SELECT action, reason, operator_id FROM manual_approvals ORDER BY created_at DESC LIMIT 1`,
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0].action).toBe("approve");
      expect(audit.rows[0].reason).toBe("Identité confirmée par WhatsApp");
      // The audit's operator is the operator's REAL user id (session).
      const opUser = await c.query(
        `SELECT "id" FROM "user" WHERE email = $1`,
        [OPERATOR_EMAIL],
      );
      expect(audit.rows[0].operator_id).toBe(opUser.rows[0].id);
    } finally {
      c.release();
    }
  });

  let orgId: string;

  it("onboarding now succeeds for the approved phone account", async () => {
    const result = await runOnboarding(client.headers, {
      name: "Boutique Maman",
      slug: "boutique-maman",
      sector: "boutique",
      baseCurrency: "USD",
      firstBranchName: "Marché Central",
    });
    orgId = result.orgId;
    expect(result.branchId).toBeTruthy();

    const me = await getMe(client.headers);
    expect(me.organization?.name).toBe("Boutique Maman");
    expect(me.role).toBe("owner");

    // Ground truth (owner role): the phone account is the org's owner member.
    const c = await admin.connect();
    try {
      const mem = await c.query(
        `SELECT role FROM member WHERE organization_id = $1`,
        [orgId],
      );
      expect(mem.rows).toHaveLength(1);
      expect(mem.rows[0].role).toBe("owner");
    } finally {
      c.release();
    }
  });

  it("lists the approval as recent (with its audit row)", async () => {
    const { recent } = await listPhoneApprovals(operator.headers);
    expect(recent.some((r) => r.phone === "+243971234567" && r.action === "approve")).toBe(true);
  });

  it("sign-in by phone works (normalized), wrong password is refused", async () => {
    const res = await signInByPhone({ phone: "097 123 4567", password: "S3cure!pass" });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().length).toBeGreaterThan(0);

    // Better Auth answers 401 "Invalid email or password" (enumeration-safe).
    await expect(
      signInByPhone({ phone: "0971234567", password: "WrongPass!99" }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("a duplicate phone sign-up is refused (409)", async () => {
    await expect(
      signUpByPhone({ name: "Copie Maman", phone: "243971234567", password: "S3cure!pass" }),
    ).rejects.toMatchObject({ code: "PHONE_TAKEN", status: 409 });
  });

  it("an unknown phone approval target is 404, bad reason is 400", async () => {
    await expect(
      operatorApplyApproval(operator.headers, {
        phone: "0999999999",
        action: "approve",
        reason: "numéro inconnu",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    // Service level: the mandatory-reason rule is a Zod validation (the HTTP
    // layer maps ZodError → 400 in src/server/http.ts).
    await expect(
      operatorApplyApproval(operator.headers, { phone, action: "revoke", reason: "x" }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("revokes — the account becomes inert again (onboarding still owned, but flag off)", async () => {
    const result = await operatorApplyApproval(operator.headers, {
      phone,
      action: "revoke",
      reason: "Annulation — erreur de validation",
    });
    expect(result.manuallyApproved).toBe(false);

    const c = await admin.connect();
    try {
      const audit = await c.query(
        `SELECT count(*)::int AS n FROM manual_approvals`,
      );
      // approve + revoke — both audited, append-only.
      expect(audit.rows[0].n).toBe(2);
    } finally {
      c.release();
    }

    // Re-approve so the org owner remains a consistent state.
    await operatorApplyApproval(operator.headers, {
      phone,
      action: "approve",
      reason: "Ré-activation confirmée par WhatsApp",
    });
  });
});

// ---------------------------------------------------------------------------

describe("email surface guard (ADR-0016)", () => {
  it("rejects email sign-up on the reserved phone domain", async () => {
    const { POST } = await import(
      "../../src/app/api/auth/[...all]/route"
    );
    const res = await POST(
      new Request(`http://localhost/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Squatteur",
          email: `243971234567@${PHONE_VIRTUAL_DOMAIN}`,
          password: "SquatPass!1",
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("PHONE_DOMAIN_RESERVED");

    // Nothing was created.
    const c = await admin.connect();
    try {
      const rows = await c.query(`SELECT count(*)::int AS n FROM "user" WHERE email = $1`, [
        `243971234567@${PHONE_VIRTUAL_DOMAIN}`,
      ]);
      // The legit phone account owns this identifier — exactly one row.
      expect(rows.rows[0].n).toBe(1);
    } finally {
      c.release();
    }
  });

  it("normal email sign-up on the same surface still works", async () => {
    const { POST } = await import("../../src/app/api/auth/[...all]/route");
    const res = await POST(
      new Request(`http://localhost/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Email Normale",
          email: "email-normale@example.cd",
          password: "SquatPass!1",
        }),
      }),
    );
    expect(res.status).toBe(200);
  });
});
