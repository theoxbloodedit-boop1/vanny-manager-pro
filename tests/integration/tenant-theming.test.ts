import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { urlsFor, startPostgres, stopPostgres } from "./pg-harness";
import { getAuth, resetAuth } from "../../src/auth";
import { closeAuthDb } from "../../src/auth/db";
import { closeTenantPool } from "../../src/db/tenant";
import { getMe } from "../../src/server/me";
import { runOnboarding } from "../../src/server/onboarding";
import {
  acceptInvitation,
  inviteMember,
} from "../../src/server/members";
import { setOrganizationTheme } from "../../src/server/theme";
import { takeCapturedMails } from "../../src/server/email";

/**
 * ADR-0015 — tenant theming on the real stack (scratch suite).
 *
 * Properties asserted:
 *   - the owner can set a catalog tone; it is persisted on the RLS-scoped org
 *     row and surfaced through /api/me;
 *   - an unknown tone id fails CLOSED (400, no write);
 *   - a non-owner (cashier) is refused (403) — org.settings.manage is
 *     owner-only in the permission matrix;
 *   - resetting to null restores the neutral tone.
 */

const TEST_SECRET = "theming-integration-secret-not-for-prod-0123456789abcd";

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

const { APP_URL, ADMIN_URL } = urlsFor("scratch");

beforeAll(async () => {
  admin = await startPostgres("scratch");
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

// ---------------------------------------------------------------------------

describe("tenant theming (ADR-0015)", () => {
  let owner: Awaited<ReturnType<typeof signup>>;
  let cashier: Awaited<ReturnType<typeof signup>>;
  let orgId: string;

  it("owner sets a catalog tone → persisted on the org row → visible in /api/me", async () => {
    owner = await signup("Alice Thème", "alice-theme@example.cd");
    await verifyEmail("alice-theme@example.cd");
    const onb = await runOnboarding(owner.headers, {
      name: "Boutique Thème",
      slug: "boutique-theme",
      sector: "boutique",
      baseCurrency: "USD",
      timezone: "Africa/Kinshasa",
      firstBranchName: "Centre-ville",
    });
    orgId = onb.orgId;

    cashier = await signup("Bob Caisse", "bob-theme@example.cd");
    await verifyEmail("bob-theme@example.cd");
    await inviteMember(owner.headers, {
      email: "bob-theme@example.cd",
      role: "cashier",
      branchIds: [onb.branchId],
    });
    const invites = (await getAuth().api.listUserInvitations({
      headers: cashier.headers,
    })) as { id: string; email: string }[];
    const inv = invites.find((i) => i.email === "bob-theme@example.cd");
    if (!inv) throw new Error("cashier did not receive the invitation");
    await acceptInvitation(cashier.headers, { invitationId: inv.id });

    await expect(
      setOrganizationTheme(owner.headers, { themeId: "ember-noir" }),
    ).resolves.toEqual({ themeId: "ember-noir" });

    const me = await getMe(owner.headers);
    expect(me.organization?.themeId).toBe("ember-noir");

    // Ground truth as the owner role (bypasses RLS).
    const c = await admin.connect();
    try {
      const row = await c.query(
        `SELECT theme_id FROM organizations WHERE id = $1`,
        [orgId],
      );
      expect(row.rows[0].theme_id).toBe("ember-noir");
    } finally {
      c.release();
    }
  });

  it("unknown tone id → 400 fail-closed, no write", async () => {
    await expect(
      setOrganizationTheme(owner.headers, { themeId: "neon-pink" }),
    ).rejects.toMatchObject({ status: 400, code: "UNKNOWN_THEME" });
    const me = await getMe(owner.headers);
    expect(me.organization?.themeId).toBe("ember-noir"); // unchanged
  });

  it("non-owner (cashier) → 403 (org.settings.manage is owner-only)", async () => {
    await expect(
      setOrganizationTheme(cashier.headers, { themeId: "crimson" }),
    ).rejects.toMatchObject({ status: 403 });
    const me = await getMe(owner.headers);
    expect(me.organization?.themeId).toBe("ember-noir"); // unchanged
  });

  it("owner resets to neutral → null in /api/me and in the DB", async () => {
    await setOrganizationTheme(owner.headers, { themeId: null });
    const me = await getMe(owner.headers);
    expect(me.organization?.themeId).toBeNull();

    const c = await admin.connect();
    try {
      const row = await c.query(
        `SELECT theme_id FROM organizations WHERE id = $1`,
        [orgId],
      );
      expect(row.rows[0].theme_id).toBeNull();
    } finally {
      c.release();
    }
  });
});
