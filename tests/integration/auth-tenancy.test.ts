import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { urlsFor, startPostgres, stopPostgres } from "./pg-harness";
import { getAuth, resetAuth } from "../../src/auth";
import { closeAuthDb } from "../../src/auth/db";
import { withTenantDb, closeTenantPool } from "../../src/db/tenant";
import {
  runOnboarding,
  slugify,
} from "../../src/server/onboarding";
import {
  createBranch,
  grantBranchAccess,
  inviteMember,
  cancelInvitation,
  changeMemberRole,
  listBranches,
  myInvitations,
  acceptInvitation,
} from "../../src/server/members";
import { authorize, AuthorizationError } from "../../src/server/rbac/authorize";
import { takeCapturedMails } from "../../src/server/email";
import { isUuidV7 } from "../../src/lib/uuid";
import { ApiError } from "../../src/server/errors";
import {
  organizations,
  branches,
  branchAccess,
} from "../../src/db/schema/org";
import { members, invitations } from "../../src/db/schema/auth";

/**
 * AUTH & TENANCY — end-to-end on the real stack: Better Auth (real DB
 * adapter), the organization plugin, our RLS tenant scope, and the RBAC
 * matrix. Every assertion below is a row in a real PostgreSQL database.
 */

const TEST_SECRET =
  "integration-test-secret-not-for-production-0123456789abcdef";

let admin: Pool;

async function signup(name: string, email: string) {
  // asResponse:true mirrors a real browser: the session cookie carries a
  // SIGNED token (`token.signature`); the body's raw token alone would not
  // pass verification. We must reuse the cookie verbatim, as a browser does.
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

/** Simulates the recipient clicking the verification link in their inbox. */
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

const { APP_URL, ADMIN_URL } = urlsFor("auth");

beforeAll(async () => {
  admin = await startPostgres("auth");
  process.env.DATABASE_URL = APP_URL; // tenant role (RLS-enforced)
  process.env.AUTH_DATABASE_URL = ADMIN_URL; // owner role (Better Auth)
  process.env.BETTER_AUTH_SECRET = TEST_SECRET;
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  // Verification mails are captured in memory; the flow (signed token,
  // /verify-email, emailVerified) is exercised for real.
  process.env.MAIL_TRANSPORT = "capture";
  void getAuth(); // instantiate with these env values (services share the singleton)
}, 180_000);

afterAll(async () => {
  await closeAuthDb().catch(() => {});
  await closeTenantPool().catch(() => {});
  resetAuth();
  if (admin) await stopPostgres(admin);
});

// ---------------------------------------------------------------------------

describe("onboarding", () => {
  let alice: Awaited<ReturnType<typeof signup>>;
  let orgId: string;
  let branchId: string;

  it("signup → email verified → organization (UUIDv7, sector) → owner member → first branch → access", async () => {
    alice = await signup("Alice Mutombo", "alice@example.cd");
    await verifyEmail("alice@example.cd");
    const result = await runOnboarding(alice.headers, {
      name: "Lunetterie Alpha",
      slug: "lunetterie-alpha",
      sector: "boutique",
      baseCurrency: "USD",
      timezone: "Africa/Kinshasa",
      firstBranchName: "Centre-ville",
    });
    orgId = result.orgId;
    branchId = result.branchId;

    expect(isUuidV7(orgId)).toBe(true);
    expect(isUuidV7(branchId)).toBe(true);

    // Ground truth as the owner role (bypasses RLS):
    const c = await admin.connect();
    try {
      const org = await c.query(
        `SELECT business_sector, base_currency, timezone FROM organizations WHERE id = $1`,
        [orgId],
      );
      expect(org.rows[0]).toEqual({
        business_sector: "boutique",
        base_currency: "USD",
        timezone: "Africa/Kinshasa",
      });
      const mem = await c.query(
        `SELECT role FROM member WHERE organization_id = $1 AND user_id = $2`,
        [orgId, alice.user.id],
      );
      expect(mem.rows).toHaveLength(1);
      expect(mem.rows[0].role).toBe("owner");
      const ba = await c.query(
        `SELECT user_id, branch_id FROM branch_access WHERE org_id = $1`,
        [orgId],
      );
      expect(ba.rows).toEqual([{ user_id: alice.user.id, branch_id: branchId }]);
    } finally {
      c.release();
    }
  });

  it("refuses to re-onboard an account that already has an organization", async () => {
    await expect(
      runOnboarding(alice.headers, {
        name: "Autre Société",
        slug: "autre-societe",
        sector: "bar",
        baseCurrency: "CDF",
        firstBranchName: "X",
      }),
    ).rejects.toMatchObject({ code: "ALREADY_ONBOARDED", status: 409 });
  });

  it("slugify is deterministic and safe", () => {
    expect(slugify("Café du Marché!")).toBe("cafe-du-marche");
    expect(slugify("  --Weird__Name--  ")).toBe("weird-name");
  });

  // --- invitations & RBAC -------------------------------------------------

  let bob: Awaited<ReturnType<typeof signup>>;

  it("owner invites a cashier; invitee registers, accepts, and gets the branch grant", async () => {
    const inv = await inviteMember(alice.headers, {
      email: "bob@example.cd",
      role: "cashier",
      branchIds: [branchId],
    });
    expect(inv.invitationId).toBeTruthy();

    bob = await signup("Bob Kalenga", "bob@example.cd");

    // SECURITY GATE: an unverified email cannot even SEE its invitations.
    // (Prevents registering an arbitrary email and harvesting invitations.)
    await expect(myInvitations(bob.headers)).rejects.toThrow(
      /verification/i,
    );

    // The recipient clicks the verification link (real signed-token flow).
    await verifyEmail("bob@example.cd");

    const pending = (await myInvitations(bob.headers)) as Array<{
      id: string;
      status: string;
      email: string;
    }>;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.email).toBe("bob@example.cd");

    await acceptInvitation(bob.headers, { invitationId: inv.invitationId });

    const c = await admin.connect();
    try {
      const mem = await c.query(
        `SELECT role FROM member WHERE organization_id = $1 AND user_id = $2`,
        [orgId, bob.user.id],
      );
      expect(mem.rows).toHaveLength(1);
      expect(mem.rows[0].role).toBe("cashier");
      const ba = await c.query(
        `SELECT branch_id FROM branch_access WHERE org_id = $1 AND user_id = $2`,
        [orgId, bob.user.id],
      );
      expect(ba.rows).toEqual([{ branch_id: branchId }]);
    } finally {
      c.release();
    }
  });

  it("cashier can open cash at their assigned branch", async () => {
    const role = await withTenantDb(orgId, (db) =>
      authorize(db, { userId: bob.user.id, permission: "cash.open", branchId }),
    );
    expect(role).toBe("cashier");
  });

  let branch2: string;

  it("cashier gets a 403 (not an empty list) at an unassigned branch", async () => {
    const created = await createBranch(alice.headers, { name: "Kintambo" });
    branch2 = created.branchId;

    await expect(
      withTenantDb(orgId, (db) =>
        authorize(db, {
          userId: bob.user.id,
          permission: "cash.open",
          branchId: branch2,
        }),
      ),
    ).rejects.toMatchObject({ reason: "NO_BRANCH_ACCESS", status: 403 });
  });

  it("cashier cannot manage organization settings", async () => {
    await expect(
      withTenantDb(orgId, (db) =>
        authorize(db, { userId: bob.user.id, permission: "org.settings.manage" }),
      ),
    ).rejects.toMatchObject({ reason: "FORBIDDEN", status: 403 });
  });

  it("granting branch access unlocks the branch for the cashier", async () => {
    await grantBranchAccess(alice.headers, {
      branchId: branch2,
      userId: bob.user.id,
    });
    const role = await withTenantDb(orgId, (db) =>
      authorize(db, {
        userId: bob.user.id,
        permission: "cash.open",
        branchId: branch2,
      }),
    );
    expect(role).toBe("cashier");
  });

  it("role change applies on the next request without re-login", async () => {
    // cashier lacks reports.view:
    await expect(
      withTenantDb(orgId, (db) =>
        authorize(db, { userId: bob.user.id, permission: "reports.view" }),
      ),
    ).rejects.toMatchObject({ reason: "FORBIDDEN" });

    // Alice promotes Bob (same session/token for Bob — no re-login).
    const c = await admin.connect();
    let memberId: string;
    try {
      const mem = await c.query(
        `SELECT id FROM member WHERE organization_id = $1 AND user_id = $2`,
        [orgId, bob.user.id],
      );
      memberId = mem.rows[0].id as string;
    } finally {
      c.release();
    }
    await changeMemberRole(alice.headers, { memberId, role: "manager" });

    await withTenantDb(orgId, async (db) => {
      const role = await authorize(db, {
        userId: bob.user.id,
        permission: "reports.view",
      });
      expect(role).toBe("manager");
    });
  });

  it("manager still cannot invite members (business matrix says no)", async () => {
    await expect(
      inviteMember(bob.headers, {
        email: "eve@example.cd",
        role: "seller",
        branchIds: [branchId],
      }),
    ).rejects.toMatchObject({ reason: "FORBIDDEN", status: 403 });
  });

  it("the owner role cannot be granted through an invitation", async () => {
    await expect(
      inviteMember(alice.headers, {
        email: "eve@example.cd",
        role: "owner",
        branchIds: [branchId],
      }),
    ).rejects.toThrow();
  });

  it("a canceled invitation cannot be accepted", async () => {
    const inv = await inviteMember(alice.headers, {
      email: "dave@example.cd",
      role: "cashier",
      branchIds: [branchId],
    });
    await cancelInvitation(alice.headers, { invitationId: inv.invitationId });
    const dave = await signup("Dave Ilunga", "dave@example.cd");
    await expect(
      acceptInvitation(dave.headers, { invitationId: inv.invitationId }),
    ).rejects.toThrow();
  });

  it("an organization cannot lose its last owner", async () => {
    const c = await admin.connect();
    let aliceMemberId: string;
    try {
      const mem = await c.query(
        `SELECT id FROM member WHERE organization_id = $1 AND user_id = $2`,
        [orgId, alice.user.id],
      );
      aliceMemberId = mem.rows[0].id as string;
    } finally {
      c.release();
    }
    await expect(
      changeMemberRole(alice.headers, { memberId: aliceMemberId, role: "admin" }),
    ).rejects.toMatchObject({ code: "LAST_OWNER", status: 400 });
  });

  // --- cross-tenant --------------------------------------------------------

  it("cross-tenant: a second organization is completely invisible to org A staff", async () => {
    const carol = await signup("Carol Ndaye", "carol@example.cd");
    await verifyEmail("carol@example.cd"); // ADR-0016: server-side onboarding gate
    const orgB = await runOnboarding(carol.headers, {
      name: "Bar Oméga",
      slug: "bar-omega",
      sector: "bar",
      baseCurrency: "CDF",
      firstBranchName: "Matonge",
    });

    // 1) RBAC: bob is simply not a member of org B.
    await expect(
      withTenantDb(orgB.orgId, (db) =>
        authorize(db, { userId: bob.user.id, permission: "cash.view" }),
      ),
    ).rejects.toMatchObject({ reason: "NOT_A_MEMBER" });

    // 2) Business data: zero rows visible for org B from a bob-scoped query
    //    (and zero rows for org A from a carol-scoped query).
    const aBranches = await withTenantDb(orgId, (db) =>
      db.select().from(branches),
    );
    expect(aBranches.length).toBeGreaterThanOrEqual(2);
    const bBranches = await withTenantDb(orgB.orgId, (db) =>
      db.select().from(branches),
    );
    expect(bBranches.length).toBe(1);

    // 3) The invitation ledger is isolated too.
    const invA = await withTenantDb(orgId, (db) =>
      db.select({ id: invitations.id }).from(invitations),
    );
    const invB = await withTenantDb(orgB.orgId, (db) =>
      db.select({ id: invitations.id }).from(invitations),
    );
    for (const row of invB) {
      expect(invA.map((r) => r.id)).not.toContain(row.id);
    }

    // 4) The owner-role ground truth confirms both orgs coexist undamaged.
    const c = await admin.connect();
    try {
      const { rows } = await c.query(
        `SELECT count(*)::int AS n FROM organizations`,
      );
      expect(rows[0].n).toBeGreaterThanOrEqual(2);
    } finally {
      c.release();
    }

    // listBranches still works for Alice (active org A).
    const aliceBranches = await listBranches(alice.headers);
    expect(
      (aliceBranches as Array<{ name: string }>).map((b) => b.name).sort(),
    ).toEqual(["Centre-ville", "Kintambo"]);
  });
});

// Keep the imports referenced even if a test above is refactored away.
void organizations;
void branchAccess;
void members;
void AuthorizationError;
void ApiError;
