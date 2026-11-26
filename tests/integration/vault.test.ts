import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { urlsFor, startPostgres, stopPostgres } from "./pg-harness";
import { getAuth, resetAuth } from "../../src/auth";
import { closeAuthDb } from "../../src/auth/db";
import { closeTenantPool } from "../../src/db/tenant";
import { getMe } from "../../src/server/me";
import { runOnboarding } from "../../src/server/onboarding";
import {
  createObligation,
  depositToVault,
  getVault,
  payObligation,
  withdrawFromVault,
} from "../../src/server/vault";
import { takeCapturedMails } from "../../src/server/email";
import { authorize } from "../../src/server/rbac/authorize";
import { withTenantDb } from "../../src/db/tenant";

/**
 * ADR-0022 — COFFRE-FORT (vault) integration tests.
 *
 * The vault is where a business accumulates money gradually to settle its
 * obligations (factures, loyer). Properties asserted:
 *   - deposit → balance increases; derived, never stored.
 *   - withdrawal fails closed when the balance is insufficient.
 *   - obligations are created, paid partially, and fully settled.
 *   - payment fails closed when the vault lacks funds.
 *   - permissions: owner deposits + manages; cashier is denied.
 */

const TEST_SECRET = "vault-integration-secret-not-for-prod-0123456789abcd";

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

const { APP_URL, ADMIN_URL } = urlsFor("vault");

beforeAll(async () => {
  admin = await startPostgres("vault");
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

describe("coffre-fort (ADR-0022)", () => {
  let owner: Awaited<ReturnType<typeof signup>>;

  beforeAll(async () => {
    owner = await signup("Alice Vault", "alice-vault@example.cd");
    await verifyEmail("alice-vault@example.cd");
    await runOnboarding(owner.headers, {
      name: "Pharmacie Beta",
      slug: "pharmacie-beta",
      sector: "pharmacy",
      baseCurrency: "USD",
      timezone: "Africa/Kinshasa",
      firstBranchName: "Siège",
    });
  }, 60_000);

  it("deposit increases the derived balance", async () => {
    await depositToVault(owner.headers, { amountMinor: 10000, currency: "USD", note: "caisse" });
    const vault = await getVault(owner.headers);
    expect(vault.summary.balanceUsdMinor).toBe(10000);
  });

  it("withdrawal fails closed when balance is insufficient", async () => {
    await expect(
      withdrawFromVault(owner.headers, { amountMinor: 999999, currency: "USD", note: null }),
    ).rejects.toThrow(/insuffis/i);
  });

  it("withdrawal works within balance and reduces it", async () => {
    await withdrawFromVault(owner.headers, { amountMinor: 2000, currency: "USD", note: "retrait" });
    const vault = await getVault(owner.headers);
    expect(vault.summary.balanceUsdMinor).toBe(8000);
  });

  it("obligations: create → pay partially → pay the rest → settled", async () => {
    const ob = await createObligation(owner.headers, {
      title: "Loyer novembre",
      kind: "rent",
      amountMinor: 4000,
      currency: "USD",
      dueAt: null,
      note: null,
    });
    expect(ob.id).toBeDefined();

    // Pay 1500 (partial) — vault holds 8000, so it succeeds.
    await payObligation(owner.headers, { obligationId: ob.id!, amountMinor: 1500 });
    let vault = await getVault(owner.headers);
    let obligation = vault.obligations.find((o) => o.id === ob.id!);
    expect(obligation?.paidMinor).toBe(1500);
    expect(obligation?.status).toBe("open");
    expect(vault.summary.balanceUsdMinor).toBe(6500); // 8000 - 1500 paid

    // Pay the rest.
    await payObligation(owner.headers, { obligationId: ob.id!, amountMinor: 2500 });
    vault = await getVault(owner.headers);
    obligation = vault.obligations.find((o) => o.id === ob.id!);
    expect(obligation?.paidMinor).toBe(4000);
    expect(obligation?.status).toBe("paid");
    expect(vault.summary.balanceUsdMinor).toBe(4000);
  });

  it("payment fails closed when the vault lacks funds", async () => {
    const ob = await createObligation(owner.headers, {
      title: "Facture électricité",
      kind: "invoice",
      amountMinor: 10000,
      currency: "USD",
      dueAt: null,
      note: null,
    });
    await expect(
      payObligation(owner.headers, { obligationId: ob.id!, amountMinor: 10000 }),
    ).rejects.toThrow(/insuffis/i);
  });

  it("a cashier is denied vault operations (permissions, not role checks)", async () => {
    const cashier = await signup("Cassie Cashier", "cassie-cashier@example.cd");
    await verifyEmail("cassie-cashier@example.cd");
    // Invite + accept as cashier in the same org.
    const inv = await (await import("../../src/server/members")).inviteMember(
      owner.headers,
      { email: "cassie-cashier@example.cd", role: "cashier" },
    );
    await (await import("../../src/server/members")).acceptInvitation(
      cashier.headers,
      { invitationId: inv.invitationId },
    );

    // Cashier may SEE the vault only if granted — by default cashier has no
    // vault.view → refused.
    await expect(getVault(cashier.headers)).rejects.toThrow();
    // And cannot deposit.
    await expect(
      depositToVault(cashier.headers, { amountMinor: 100, currency: "USD", note: null }),
    ).rejects.toThrow();
  });

  it("owner permissions include vault.deposit and vault.manage", async () => {
    const me = await getMe(owner.headers);
    expect(me.permissions).toContain("vault.view");
    expect(me.permissions).toContain("vault.deposit");
    expect(me.permissions).toContain("vault.manage");
  });

  it("the authorize() permission matrix is enforced on the tenant DB", async () => {
    const me = await getMe(owner.headers);
    const orgId = me.organization!.id;
    // owner → vault.deposit allowed.
    await withTenantDb(orgId, async (db) => {
      await expect(
        authorize(db, { userId: owner.user.id, permission: "vault.deposit" }),
      ).resolves.toBeTruthy();
    });
  });
});
