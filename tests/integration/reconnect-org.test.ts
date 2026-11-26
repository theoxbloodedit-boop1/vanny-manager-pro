import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { urlsFor, startPostgres, stopPostgres } from "./pg-harness";
import { getAuth, resetAuth } from "../../src/auth";
import { closeAuthDb } from "../../src/auth/db";
import { closeTenantPool } from "../../src/db/tenant";
import { getMe } from "../../src/server/me";
import { runOnboarding } from "../../src/server/onboarding";
import { takeCapturedMails } from "../../src/server/email";

/**
 * ADR-0021 — reconnect: an existing user who signs back in must land on
 * their dashboard, NOT on the onboarding screen.
 *
 * The bug: a fresh session carries no `activeOrganizationId`, so /api/me
 * returned `organization: null` and the user fell back to the onboarding
 * flow — where they could recreate a duplicate business.
 *
 * The fix: getMe() looks up the user's membership and restores the active
 * organization automatically. These tests assert that end-to-end on the
 * real stack, including the sign-out / sign-in cycle that reproduces the
 * reconnect path.
 */

const TEST_SECRET = "reconnect-integration-secret-not-for-prod-0123456789abcd";

let admin: Pool;

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

/** Recipient clicks the verification link (real signed-token flow). */
async function verifyEmail(email: string) {
  const mails = takeCapturedMails().filter((m) => m.to === email);
  if (mails.length === 0) throw new Error(`no verification mail for ${email}`);
  const token = mails[mails.length - 1]!.token;
  if (!token) throw new Error("verification mail has no token");
  const result = (await getAuth().api.verifyEmail({
    query: { token },
  })) as { status: boolean };
  expect(result.status).toBe(true);
}

const { APP_URL, ADMIN_URL } = urlsFor("reconnect");

beforeAll(async () => {
  admin = await startPostgres("reconnect");
  process.env.DATABASE_URL = APP_URL; // tenant role (RLS-enforced)
  process.env.AUTH_DATABASE_URL = ADMIN_URL; // owner role (Better Auth)
  process.env.BETTER_AUTH_SECRET = TEST_SECRET;
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.MAIL_TRANSPORT = "capture";
  void getAuth();
}, 180_000);

afterAll(async () => {
  await closeAuthDb().catch(() => {});
  await closeTenantPool().catch(() => {});
  resetAuth();
  if (admin) await stopPostgres(admin);
});

describe("reconnect (ADR-0021): existing user lands on their org", () => {
  it("after sign-out + sign-in, /api/me restores the active organization — no onboarding", async () => {
    const u = await signup("Alice Reconnect", "alice-reconnect@example.cd");
    await verifyEmail("alice-reconnect@example.cd");

    // First onboarding: create the business + first branch.
    await runOnboarding(u.headers, {
      name: "Pharmacie Alpha",
      slug: "pharmacie-alpha",
      sector: "pharmacy",
      baseCurrency: "USD",
      timezone: "Africa/Kinshasa",
      firstBranchName: "Siège",
    });

    const before = await getMe(u.headers);
    expect(before.authenticated).toBe(true);
    expect(before.organization?.name).toBe("Pharmacie Alpha");

    // Sign out, then sign in again — the reconnect path.
    await getAuth().api.signOut({ headers: u.headers });

    const relogin = (await getAuth().api.signInEmail({
      body: { email: "alice-reconnect@example.cd", password: "S3cure!pass" },
      asResponse: true,
      returnHeaders: true,
    })) as unknown as Response;
    const cookie = relogin.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("sign-in did not set a session cookie");
    const fresh = new Headers({ cookie });

    // The fresh session has NO active organization — the bug scenario.
    const me = await getMe(fresh);
    expect(me.authenticated).toBe(true);

    // ADR-0021: getMe must restore the org — the user sees their dashboard,
    // NOT the onboarding screen.
    expect(me.organization).not.toBeNull();
    expect(me.organization?.name).toBe("Pharmacie Alpha");
    expect(me.organization?.businessSector).toBe("pharmacy");
    expect(me.role).toBe("owner");
  });

  it("a user with NO org still sees onboarding (nothing is invented)", async () => {
    const fresh = await signup("Bob NoOrg", "bob-noorg@example.cd");
    await verifyEmail("bob-noorg@example.cd");
    const me = await getMe(fresh.headers);
    expect(me.authenticated).toBe(true);
    expect(me.organization).toBeNull();
  });
});
