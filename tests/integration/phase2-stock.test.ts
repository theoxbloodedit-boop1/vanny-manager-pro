import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { urlsFor, startPostgres, stopPostgres } from "./pg-harness";
import { getAuth, resetAuth } from "../../src/auth";
import { closeAuthDb } from "../../src/auth/db";
import {
  withTenantDb,
  getTenantPool,
  closeTenantPool,
} from "../../src/db/tenant";
import {
  runOnboarding,
} from "../../src/server/onboarding";
import { createBranch, grantBranchAccess } from "../../src/server/members";
import {
  createProduct,
  updateProduct,
  deleteProduct,
  listProducts,
} from "../../src/server/catalog";
import {
  listStock,
  listMovements,
  recordMovement,
  transferStock,
} from "../../src/server/inventory";
import { takeCapturedMails } from "../../src/server/email";
import { stockMovements } from "../../src/db/schema/catalog";
import { uuidv7 } from "../../src/lib/uuid";
import { ApiError } from "../../src/server/errors";

/**
 * PHASE 2 — CATALOG & STOCK (ADR-0018, Gate 2) on a REAL PostgreSQL server.
 *
 * AC-1: branch_stock (view) == independent recomputation after every mutation.
 * AC-2: a transfer whose 2nd write fails leaves NO rows (rollback proven).
 * AC-3: negative stock → 409 INSUFFICIENT_STOCK; services → 409 SERVICE_NO_STOCK.
 * AC-4: no price → 400; last price cannot be removed; USD/CDF independent.
 * AC-5: unaccent search finds accented + plain names, < 150 ms on 10k products.
 * AC-6: direct UPDATE/DELETE on the ledger is rejected by the DB trigger.
 * AC-7: tenant B never sees tenant A's catalog or movements (RLS).
 * + ADR-0018 §4 risk 1: two concurrent transfers of the last unit — one wins.
 */

const TEST_SECRET = "phase2-stock-secret-not-for-production-0123456789abc";

const { APP_URL, ADMIN_URL } = urlsFor("scratch");

let admin: Pool;

async function signup(name: string, email: string) {
  const res = (await getAuth().api.signUpEmail({
    body: { name, email, password: "S3cure!pass" },
    asResponse: true,
    returnHeaders: true,
  })) as unknown as Response;
  const { user } = (await res.json()) as { user: { id: string; email: string } };
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

/** INDEPENDENT recomputation — raw SQL, no view, owner role (AC-1 / T3). */
async function recompute(branchId: string, productId: string): Promise<number> {
  const { rows } = await admin.query(
    `SELECT COALESCE(SUM(qty_delta), 0) AS qty
       FROM stock_movements
      WHERE branch_id = $1 AND product_id = $2`,
    [branchId, productId],
  );
  return Number(rows[0].qty);
}

/**
 * The branch_stock VIEW, read as the owner (bypasses RLS — view definition).
 * A (branch, product) pair with no movements has NO group row in the view —
 * that is "0 in stock", so we normalize the missing row to 0.
 */
async function viewQty(branchId: string, productId: string): Promise<number> {
  const { rows } = await admin.query(
    `SELECT COALESCE(qty, 0) AS qty FROM branch_stock
      WHERE branch_id = $1 AND product_id = $2`,
    [branchId, productId],
  );
  return Number(rows[0]?.qty ?? 0);
}

/** AC-1 helper: the invariant must hold for a product at a branch. */
async function expectInvariant(branchId: string, productId: string) {
  const [view, recomputed] = await Promise.all([
    viewQty(branchId, productId),
    recompute(branchId, productId),
  ]);
  expect(view).toBe(recomputed);
}

let alice: Awaited<ReturnType<typeof signup>>;
let carol: Awaited<ReturnType<typeof signup>>;
let orgA: string;
let orgB: string;
let brA: string; // Centre
let brA2: string; // Lubumbashi
let brB: string;

beforeAll(async () => {
  admin = await startPostgres("scratch");
  admin.on("error", () => {}); // 57P01 teardown notices
  process.env.DATABASE_URL = APP_URL; // tenant role (RLS-enforced)
  process.env.AUTH_DATABASE_URL = ADMIN_URL; // owner role (Better Auth)
  process.env.BETTER_AUTH_SECRET = TEST_SECRET;
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.MAIL_TRANSPORT = "capture";
  getTenantPool().on("error", () => {});
  void getAuth();

  // Tenant A: two branches, owner has access to both.
  alice = await signup("Alice Mutombo", "alice@vanny.cd");
  await verifyEmail("alice@vanny.cd");
  const onA = await runOnboarding(alice.headers, {
    name: "Pharmacie Alpha",
    slug: "pharmacie-alpha",
    sector: "pharmacy",
    baseCurrency: "USD",
    timezone: "Africa/Kinshasa",
    firstBranchName: "Centre",
  });
  orgA = onA.orgId;
  brA = onA.branchId;
  const onA2 = await createBranch(alice.headers, { name: "Lubumbashi" });
  brA2 = onA2.branchId;
  await grantBranchAccess(alice.headers, {
    branchId: brA2,
    userId: alice.user.id,
  });

  // Tenant B: its own isolated org (AC-7).
  carol = await signup("Carol Mwamba", "carol@vanny.cd");
  await verifyEmail("carol@vanny.cd");
  const onB = await runOnboarding(carol.headers, {
    name: "Boutique Oméga",
    slug: "boutique-omega",
    sector: "boutique",
    baseCurrency: "CDF",
    timezone: "Africa/Kinshasa",
    firstBranchName: "Gombe",
  });
  orgB = onB.orgId;
  brB = onB.branchId;
}, 240_000);

afterAll(async () => {
  await closeAuthDb().catch(() => {});
  await closeTenantPool().catch(() => {});
  resetAuth();
  if (admin) await stopPostgres(admin);
});

// ---------------------------------------------------------------------------

describe("AC-1 — T3: branch_stock == Σ movements after every mutation", () => {
  it("purchase, adjustment +, adjustment −, transfer — invariant holds at both branches", async () => {
    const created = await createProduct(alice.headers, {
      name: "Paracétamol 500mg",
      prices: { USD: 250, CDF: 5000 },
      lowStockThreshold: 10,
    });
    const pId = created.id;

    // purchase +50 at Centre
    await recordMovement(alice.headers, {
      type: "purchase",
      branchId: brA,
      productId: pId,
      qty: 50,
      reference: "Achat #1",
    });
    await expectInvariant(brA, pId);
    expect(await viewQty(brA, pId)).toBe(50);
    expect(await viewQty(brA2, pId)).toBe(0);

    // adjustment +10 at Centre
    await recordMovement(alice.headers, {
      type: "adjustment",
      branchId: brA,
      productId: pId,
      qty: 10,
      direction: "in",
      reason: "Réception oubliée",
    });
    await expectInvariant(brA, pId);
    expect(await viewQty(brA, pId)).toBe(60);

    // adjustment −20 at Centre
    await recordMovement(alice.headers, {
      type: "adjustment",
      branchId: brA,
      productId: pId,
      qty: 20,
      direction: "out",
      reason: "Inventaire annuel",
    });
    await expectInvariant(brA, pId);
    expect(await viewQty(brA, pId)).toBe(40);

    // transfer 15 Centre → Lubumbashi
    await transferStock(alice.headers, {
      fromBranchId: brA,
      toBranchId: brA2,
      items: [{ productId: pId, qty: 15 }],
    });
    await expectInvariant(brA, pId);
    await expectInvariant(brA2, pId);
    expect(await viewQty(brA, pId)).toBe(25);
    expect(await viewQty(brA2, pId)).toBe(15);

    // The transfer pair is linked by a shared reference + counterparty.
    const { rows } = await admin.query(
      `SELECT type, qty_delta, counterparty_branch_id FROM stock_movements
        WHERE product_id = $1 AND type IN ('transfer_out','transfer_in')`,
      [pId],
    );
    expect(rows).toHaveLength(2);
    const out = rows.find((r: { type: string }) => r.type === "transfer_out")!;
    const inn = rows.find((r: { type: string }) => r.type === "transfer_in")!;
    expect(out.qty_delta).toBe(-15);
    expect(inn.qty_delta).toBe(15);
    expect(String(out.counterparty_branch_id)).toBe(brA2);
    expect(String(inn.counterparty_branch_id)).toBe(brA);
  });
});

describe("AC-2 — atomic transfer: failure leaves no intermediate state", () => {
  it("insufficient stock mid-transfer → 409 and the ledger is untouched", async () => {
    const created = await createProduct(alice.headers, {
      name: "Sérum physiologique",
      prices: { CDF: 1200 },
    });
    const pId = created.id;
    await recordMovement(alice.headers, {
      type: "purchase",
      branchId: brA,
      productId: pId,
      qty: 5,
    });

    const before = await recompute(brA, pId);
    await expect(
      transferStock(alice.headers, {
        fromBranchId: brA,
        toBranchId: brA2,
        items: [{ productId: pId, qty: 99 }],
        reference: "TRF-DOOMED",
      }),
    ).rejects.toMatchObject({ status: 409, code: "INSUFFICIENT_STOCK" });
    expect(await recompute(brA, pId)).toBe(before);
    const { rows } = await admin.query(
      `SELECT count(*)::int AS n FROM stock_movements WHERE reference = 'TRF-DOOMED'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it("a transfer whose 2nd WRITE fails at the DB level rolls back the 1st (raw tx)", async () => {
    const created = await createProduct(alice.headers, {
      name: "Comprimé vitamine C",
      prices: { USD: 100 },
    });
    const pId = created.id;
    const before = await recompute(orgA === "" ? brA : brA, pId);

    await expect(
      withTenantDb(orgA, async (db) => {
        // 1st write: a perfectly valid transfer_out row.
        await db.insert(stockMovements).values({
          id: uuidv7(),
          orgId: orgA,
          branchId: brA,
          productId: pId,
          counterpartyBranchId: brA2,
          type: "transfer_out",
          qtyDelta: -1,
          reference: "TRF-ROLLBACK",
          reason: null,
          createdById: alice.user.id,
        });
        // 2nd write: invalid enum value → DB error mid-transaction.
        await db.execute(sql`
          INSERT INTO stock_movements
            (id, org_id, branch_id, product_id, type, qty_delta, created_by_id)
          VALUES (${uuidv7()}, ${orgA}, ${brA2}, ${pId}, 'not_a_type', 1, 'tester')
        `);
      }),
    ).rejects.toThrow();

    // ROLLBACK proven: the 1st write is gone, nothing new exists.
    expect(await recompute(brA, pId)).toBe(before);
    const { rows } = await admin.query(
      `SELECT count(*)::int AS n FROM stock_movements WHERE reference = 'TRF-ROLLBACK'`,
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("AC-3 — explicit refusals", () => {
  it("an out-movement that would go negative → 409 INSUFFICIENT_STOCK, stock unchanged", async () => {
    const created = await createProduct(alice.headers, {
      name: "Masque chirurgical",
      prices: { USD: 50 },
    });
    const pId = created.id;
    await recordMovement(alice.headers, {
      type: "purchase",
      branchId: brA,
      productId: pId,
      qty: 3,
    });

    await expect(
      recordMovement(alice.headers, {
        type: "adjustment",
        branchId: brA,
        productId: pId,
        qty: 10,
        direction: "out",
        reason: "Casse constatée",
      }),
    ).rejects.toMatchObject({ status: 409, code: "INSUFFICIENT_STOCK" });
    expect(await viewQty(brA, pId)).toBe(3);

    // An adjustment without a reason is rejected by validation.
    await expect(
      recordMovement(alice.headers, {
        type: "adjustment",
        branchId: brA,
        productId: pId,
        qty: 1,
        direction: "out",
      }),
    ).rejects.toThrow();
  });

  it("a service never moves stock → 409 SERVICE_NO_STOCK", async () => {
    const created = await createProduct(alice.headers, {
      name: "Consultation médicale",
      kind: "service",
      prices: { CDF: 1000 },
    });
    const pId = created.id;
    await expect(
      recordMovement(alice.headers, {
        type: "purchase",
        branchId: brA,
        productId: pId,
        qty: 1,
      }),
    ).rejects.toMatchObject({ status: 409, code: "SERVICE_NO_STOCK" });
    const { rows } = await admin.query(
      `SELECT count(*)::int AS n FROM stock_movements WHERE product_id = $1`,
      [pId],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("AC-4 — prices: at least one, never derived, last price protected", () => {
  it("creation without any price → 400 (VALIDATION)", async () => {
    await expect(
      createProduct(alice.headers, { name: "Produit sans prix" }),
    ).rejects.toThrow(); // ZodError → 400 at the route
  });

  it("USD and CDF stay independent (no conversion)", async () => {
    const created = await createProduct(alice.headers, {
      name: "Thé vert",
      prices: { USD: 250 }, // 2.50 USD, CDF absent
    });
    const pId = created.id;

    let list = await listProducts(alice.headers, new URLSearchParams({}));
    let row = list.find((p) => p.id === pId)!;
    expect(row.priceUsdMinor).toBe(250);
    expect(row.priceCdfMinor).toBeNull();

    // Add a CDF price: it is stored AS GIVEN, not derived from 2.50 USD.
    await updateProduct(alice.headers, pId, { prices: { CDF: 5000 } });
    list = await listProducts(alice.headers, new URLSearchParams({}));
    row = list.find((p) => p.id === pId)!;
    expect(row.priceUsdMinor).toBe(250);
    expect(row.priceCdfMinor).toBe(5000);
  });

  it("removing the LAST price → 400 PRICE_REQUIRED", async () => {
    const created = await createProduct(alice.headers, {
      name: "Eau minérale 50cl",
      prices: { CDF: 300 },
    });
    const pId = created.id;
    await expect(
      updateProduct(alice.headers, pId, { prices: { CDF: null } }),
    ).rejects.toMatchObject({ status: 400, code: "PRICE_REQUIRED" });
    // The price survived (the update rolled back atomically).
    const list = await listProducts(alice.headers, new URLSearchParams({}));
    expect(list.find((p) => p.id === pId)!.priceCdfMinor).toBe(300);
  });
});

describe("AC-5 — unaccent search on 10k products, under 150 ms", () => {
  it("« cafe » finds « Café », « cafe » finds « Café », and it stays fast", async () => {
    const c = await admin.connect();
    try {
      // Bulk-load 10k accented products + one plain (unaccented) twin and one
      // accented twin, as the owner.
      await c.query(
        `INSERT INTO products (id, org_id, name, sku, kind, unit, is_active)
         SELECT md5('bulk-cafe-' || g)::uuid, $1, 'Café No ' || g, 'BULK-' || g,
                'product', 'pièce', true
         FROM generate_series(1, 10000) g`,
        [orgA],
      );
      await c.query(
        `INSERT INTO products (id, org_id, name, sku, kind, unit, is_active)
         VALUES
           (md5('plain-cafe')::uuid, $1, 'cafe filtre', 'CAFE-0', 'product', 'sachet', true),
           (md5('accented-cafe')::uuid, $1, 'Café filtre', 'CAFE-1', 'product', 'sachet', true)`,
        [orgA],
      );
    } finally {
      await c.release();
    }

    // Unaccented input finds the accented product…
    const r1 = await listProducts(alice.headers, new URLSearchParams({ q: "cafe filtre" }));
    expect(r1.map((p) => p.name)).toContain("Café filtre");

    // …and accented input finds the unaccented one.
    const r2 = await listProducts(alice.headers, new URLSearchParams({ q: "Café filtre" }));
    expect(r2.map((p) => p.name)).toContain("cafe filtre");

    // Performance: a broad query over the 10k-product org stays < 150 ms.
    const t0 = performance.now();
    const results = await listProducts(alice.headers, new URLSearchParams({ q: "cafe" }));
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(150);
    expect(results.length).toBeGreaterThan(0);
    expect(results.map((p) => p.name).some((n) => n.startsWith("Café No"))).toBe(true);
  });
});

describe("AC-6 — the ledger is append-only even for the owner role", () => {
  it("UPDATE and DELETE are rejected by the trigger; INSERT still works", async () => {
    const created = await createProduct(alice.headers, {
      name: "Jus d'orange",
      prices: { USD: 75 },
    });
    const pId = created.id;
    await recordMovement(alice.headers, {
      type: "purchase",
      branchId: brA,
      productId: pId,
      qty: 7,
    });

    await expect(
      admin.query(`UPDATE stock_movements SET qty_delta = 999 WHERE product_id = $1`, [pId]),
    ).rejects.toThrow(/append-only/);
    await expect(
      admin.query(`DELETE FROM stock_movements WHERE product_id = $1`, [pId]),
    ).rejects.toThrow(/append-only/);
    expect(await viewQty(brA, pId)).toBe(7);

    // INSERT remains the only write path.
    await recordMovement(alice.headers, {
      type: "adjustment",
      branchId: brA,
      productId: pId,
      qty: 1,
      direction: "out",
      reason: "Perte",
    });
    expect(await viewQty(brA, pId)).toBe(6);

    // And a zero-quantity document is rejected by the CHECK constraint.
    await expect(
      admin.query(
        `INSERT INTO stock_movements (id, org_id, branch_id, product_id, type, qty_delta, created_by_id)
         VALUES (md5('zero-mv')::uuid, $1, $2, $3, 'purchase', 0, 'tester')`,
        [orgA, brA, pId],
      ),
    ).rejects.toThrow();
  });
});

describe("AC-7 — tenant isolation (RLS) on catalog and stock", () => {
  it("tenant B never reads tenant A's products or movements — and vice versa", async () => {
    const createdB = await createProduct(carol.headers, {
      name: "Huile de palme",
      prices: { CDF: 4500 },
    });
    await recordMovement(carol.headers, {
      type: "purchase",
      branchId: brB,
      productId: createdB.id,
      qty: 40,
    });

    // A sees no B product, and B sees no A movement.
    const listA = await listProducts(alice.headers, new URLSearchParams({}));
    expect(listA.some((p) => p.name === "Huile de palme")).toBe(false);
    const movsB = await listMovements(carol.headers, new URLSearchParams({ limit: "50" }));
    expect(movsB).toHaveLength(1);
    expect(movsB[0]!.productName).toBe("Huile de palme");
    // …and its ledger row really belongs to tenant B, not A.
    expect(String(movsB[0]!.branchId)).toBe(brB);
    const { rows: mvRows } = await admin.query(
      `SELECT org_id FROM stock_movements WHERE branch_id = $1`,
      [brB],
    );
    expect(mvRows.length).toBeGreaterThan(0);
    expect(mvRows.every((r: { org_id: string }) => String(r.org_id) === orgB)).toBe(true);

    // A (owner) is exempt from the branch-grant gate (ADR-0026), so cross-tenant
    // isolation is enforced at the RLS branch check: B's branch is invisible to
    // A → 404 (no leak, not an empty success).
    await expect(
      recordMovement(alice.headers, {
        type: "purchase",
        branchId: brB,
        productId: createdB.id,
        qty: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });

    // And B's product is invisible to A's own stock ops (RLS → 404, no leak).
    await expect(
      recordMovement(alice.headers, {
        type: "purchase",
        branchId: brA,
        productId: createdB.id,
        qty: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });

    // A's stock view contains only A's branches.
    const stockA = await listStock(alice.headers, new URLSearchParams({}));
    expect(stockA.every((s) => s.branchId === brA || s.branchId === brA2)).toBe(true);

    // The branch_stock VIEW itself is RLS-scoped for the app role.
    const rows = await withTenantDb(orgA, async (db) =>
      db.execute(sql`SELECT count(DISTINCT org_id)::int AS n FROM branch_stock`),
    );
    expect(Number((rows.rows[0] as { n: number }).n)).toBe(1);
  });
});

describe("ADR-0018 §4 risk 1 — concurrency: one unit, two parallel transfers", () => {
  it("exactly one transfer wins; the other gets 409; stock ends at 0/1", async () => {
    const created = await createProduct(alice.headers, {
      name: "Dernière unité",
      prices: { USD: 999 },
    });
    const pId = created.id;
    await recordMovement(alice.headers, {
      type: "purchase",
      branchId: brA,
      productId: pId,
      qty: 1,
    });

    const results = await Promise.allSettled([
      transferStock(alice.headers, {
        fromBranchId: brA,
        toBranchId: brA2,
        items: [{ productId: pId, qty: 1 }],
        reference: "CONC-1",
      }),
      transferStock(alice.headers, {
        fromBranchId: brA,
        toBranchId: brA2,
        items: [{ productId: pId, qty: 1 }],
        reference: "CONC-2",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const err = (rejected[0] as PromiseRejectedResult).reason as ApiError;
    expect(err).toMatchObject({ status: 409, code: "INSUFFICIENT_STOCK" });

    await expectInvariant(brA, pId);
    await expectInvariant(brA2, pId);
    expect(await viewQty(brA, pId)).toBe(0);
    expect(await viewQty(brA2, pId)).toBe(1);
  });
});

describe("ADR-0018 D8 — deletion guard", () => {
  it("a product with stock history cannot be deleted (409); an empty one can", async () => {
    const withHistory = await createProduct(alice.headers, {
      name: "Produit historique",
      prices: { USD: 100 },
    });
    await recordMovement(alice.headers, {
      type: "purchase",
      branchId: brA,
      productId: withHistory.id,
      qty: 2,
    });
    await expect(
      deleteProduct(alice.headers, withHistory.id),
    ).rejects.toMatchObject({ status: 409, code: "HAS_MOVEMENTS" });

    const empty = await createProduct(alice.headers, {
      name: "Produit vierge",
      prices: { USD: 100 },
    });
    await deleteProduct(alice.headers, empty.id);
    const { rows } = await admin.query(
      `SELECT count(*)::int AS n FROM products WHERE id = $1`,
      [empty.id],
    );
    expect(rows[0].n).toBe(0);
  });
});
