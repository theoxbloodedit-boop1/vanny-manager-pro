import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import { Pool } from "pg";
import { APP_URL, startPostgres, stopPostgres, seed } from "./pg-harness";
import {
  withTenantDb,
  closeTenantPool,
  getTenantPool,
} from "../../src/db/tenant";
import { products, productPrices, cashSessions } from "../../src/db/schema";

/**
 * TENANT ISOLATION — the security tests that justify the whole schema.
 *
 * Topology under test:
 *   - schema owner  `postgres`    (bypasses RLS, provisioning only)
 *   - app role      `tenant_app`  (RLS enforced; this is what `withTenantDb` uses)
 *   - tenants       org A and org B, each with branch / register / product
 *
 * These tests run against a real PostgreSQL server, not a mock.
 */

const ORG_A = "11111111-2222-4333-8444-555555555555";
const ORG_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BR_A = "11111111-2222-4333-8444-666666666666";
const BR_B = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";
const REG_A = "11111111-2222-4333-8444-777777777777";
const REG_B = "aaaaaaaa-bbbb-4ccc-8ddd-000000000000";
const PROD_A = "11111111-2222-4333-8444-888888888888";
const PROD_B = "aaaaaaaa-bbbb-4ccc-8ddd-111111111111";
const PROD_A2 = "11111111-2222-4333-8444-999999999999";

const S_USD_1 = "22222222-3333-4444-8555-666666666666";
const S_USD_2 = "22222222-3333-4444-8555-777777777777";
const S_CDF_1 = "22222222-3333-4444-8555-888888888888";
const S_USD_3 = "22222222-3333-4444-8555-999999999999";

let admin: Pool;

/** Drizzle wraps pg errors in a `cause`; dig the SQLSTATE code out. */
function pgCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const cur = e as { code?: unknown; cause?: unknown };
    if (typeof cur.code === "string") return cur.code;
    e = cur.cause;
  }
  return undefined;
}


beforeAll(async () => {
  admin = await startPostgres();
  const c = await admin.connect();
  try {
    await seed.org(c, ORG_A, "Lunetterie Alpha", "boutique");
    await seed.org(c, ORG_B, "Bar Oméga", "bar");
    await seed.branch(c, BR_A, ORG_A, "Centre-ville");
    await seed.branch(c, BR_B, ORG_B, "Kintambo");
    await seed.register(c, REG_A, ORG_A, BR_A, "C1");
    await seed.register(c, REG_B, ORG_B, BR_B, "C1");
    await seed.product(c, PROD_A, ORG_A, "Montures acétate");
    await seed.price(c, PROD_A, ORG_A, "USD", 2500);
    await seed.price(c, PROD_A, ORG_A, "CDF", 2500000);
    await seed.product(c, PROD_B, ORG_B, "Bière artisanale 33cl");
    await seed.price(c, PROD_B, ORG_B, "USD", 300);
  } finally {
    c.release();
  }
  // `withTenantDb` builds its pool from DATABASE_URL on first use.
  process.env.DATABASE_URL = APP_URL;
  // Swallow 57P01 (server-shutdown) on idle tenant-pool clients during the
  // embedded-PG teardown — a teardown artifact, not a test failure.
  getTenantPool().on("error", () => {});
}, 120_000);

afterAll(async () => {
  await closeTenantPool().catch(() => {});
  if (admin) await stopPostgres(admin);
});

describe("RLS — read isolation", () => {
  it("a scoped session sees exactly its own tenant's rows", async () => {
    const rows = await withTenantDb(ORG_A, async (db) =>
      db.select().from(products),
    );
    expect(rows.map((r) => r.id)).toEqual([PROD_A]);
  });

  it("cannot read another tenant's row even with its exact id", async () => {
    const rows = await withTenantDb(ORG_A, async (db) =>
      db.select().from(products).where(eq(products.id, PROD_B)),
    );
    expect(rows).toHaveLength(0);
  });

  it("an unscoped app connection sees NOTHING (fail closed)", async () => {
    // Raw pool as tenant_app — no set_config at all.
    const raw = new Pool({ connectionString: APP_URL, max: 1 });
    try {
      const { rows } = await raw.query(`SELECT count(*)::int AS n FROM products`);
      expect(rows[0]?.n).toBe(0);
    } finally {
      await raw.end();
    }
  });

  it("the owner role still sees both tenants (proves RLS is doing the work)", async () => {
    const { rows } = await admin.query(`SELECT count(*)::int AS n FROM products`);
    expect(rows[0]?.n).toBe(2);
  });
});

describe("RLS — write isolation", () => {
  it("cannot INSERT a row into another tenant", async () => {
    // SQLSTATE 42501 (insufficient_privilege) — that is how PostgreSQL
    // reports an RLS WITH CHECK violation, not 23514.
    await expect(
      withTenantDb(ORG_A, async (db) =>
        db.insert(products).values({ id: PROD_A2, orgId: ORG_B, name: "Infiltration" }),
      ),
    ).rejects.toSatisfy((e) => pgCode(e) === "42501"); // RLS policy violation
  });

  it("cannot UPDATE another tenant's rows (0 rows affected, data untouched)", async () => {
    // Direct, raw app-role check: the UPDATE affects zero rows.
    const raw = new Pool({ connectionString: APP_URL, max: 1 });
    try {
      const res = await raw.query(
        `UPDATE products SET name = 'PIRED' WHERE id = $1 AND org_id = $2`,
        [PROD_B, ORG_A],
      );
      expect(res.rowCount).toBe(0);
    } finally {
      await raw.end();
    }
    // And through the sanctioned path it completes without error...
    await withTenantDb(ORG_A, async (db) =>
      db.update(products).set({ name: "PIRED" }).where(eq(products.id, PROD_B)),
    );
    // ...and the owner-side ground truth is unchanged.
    const { rows } = await admin.query(`SELECT name FROM products WHERE id = $1`, [
      PROD_B,
    ]);
    expect(rows[0]?.name).toBe("Bière artisanale 33cl");
  });

  it("cannot DELETE another tenant's rows (scoped, 0 rows affected)", async () => {
    const raw = new Pool({ connectionString: APP_URL, max: 1 });
    const client = await raw.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.org_id', $1, true)", [ORG_A]);
      const res = await client.query(`DELETE FROM products WHERE id = $1`, [PROD_B]);
      expect(res.rowCount).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await raw.end();
    }
    const { rows } = await admin.query(`SELECT count(*)::int AS n FROM products WHERE id = $1`, [
      PROD_B,
    ]);
    expect(rows[0]?.n).toBe(1);
  });

  it("an unscoped app connection sees 0 rows on EVERY tenant table", async () => {
    const TENANT_TABLES = [
      "organizations",
      "branches",
      "categories",
      "products",
      "product_prices",
      "cash_registers",
      "cash_sessions",
    ] as const;
    const raw = new Pool({ connectionString: APP_URL, max: 1 });
    try {
      for (const table of TENANT_TABLES) {
        const { rows } = await raw.query(
          `SELECT count(*)::int AS n FROM "${table}"`,
        );
        expect(rows[0]?.n, `unscoped read of ${table}`).toBe(0);
      }
    } finally {
      await raw.end();
    }
  });
});

describe("composite FK — a price can never claim a foreign tenant", () => {
  it("rejects a price row whose org differs from its product's org", async () => {
    // Note: currency must be one NOT yet priced for PROD_B (USD is taken —
    // the (product_id, currency) PK would fire first). CDF isolates the FK.
    await expect(
      withTenantDb(ORG_A, async (db) =>
        db.insert(productPrices).values({
          productId: PROD_B, // org B's product
          orgId: ORG_A, // ...but claiming org A
          currency: "CDF",
          amountMinor: 1,
        }),
      ),
    ).rejects.toSatisfy((e) => pgCode(e) === "23503"); // foreign key violation
  });


});

describe("cash — one open session per (register, currency)", () => {
  it("rejects a second OPEN USD session on the same register", async () => {
    // First session opens fine...
    await withTenantDb(ORG_A, async (db) =>
      db.insert(cashSessions).values({
        id: S_USD_1,
        orgId: ORG_A,
        branchId: BR_A,
        registerId: REG_A,
        currency: "USD",
        cashierMemberId: "member-a1",
        openedAt: new Date(),
      }),
    );
    // ...the second OPEN USD session on that register is a hard constraint error.
    await expect(
      withTenantDb(ORG_A, async (db) =>
        db.insert(cashSessions).values({
          id: S_USD_2,
          orgId: ORG_A,
          branchId: BR_A,
          registerId: REG_A,
          currency: "USD",
          cashierMemberId: "member-a2",
          openedAt: new Date(),
        }),
      ),
    ).rejects.toSatisfy((e) => pgCode(e) === "23505"); // unique constraint violation
  });

  it("allows a CDF session on the same register (separate balance)", async () => {
    await withTenantDb(ORG_A, async (db) =>
      db.insert(cashSessions).values({
        id: S_CDF_1,
        orgId: ORG_A,
        branchId: BR_A,
        registerId: REG_A,
        currency: "CDF",
        cashierMemberId: "member-a1",
        openedAt: new Date(),
      }),
    );
    const sessions = await withTenantDb(ORG_A, async (db) =>
      db
        .select()
        .from(cashSessions)
        .where(and(eq(cashSessions.registerId, REG_A))),
    );
    const currencies = sessions.map((s) => s.currency).sort();
    expect(currencies).toEqual(["CDF", "USD"]);
  });

  it("allows a new USD session after the first is closed (handover)", async () => {
    await withTenantDb(ORG_A, async (db) =>
      db
        .update(cashSessions)
        .set({ status: "closed", closedAt: new Date() })
        .where(and(eq(cashSessions.registerId, REG_A), eq(cashSessions.currency, "USD"))),
    );
    await withTenantDb(ORG_A, async (db) =>
      db.insert(cashSessions).values({
        id: S_USD_3,
        orgId: ORG_A,
        branchId: BR_A,
        registerId: REG_A,
        currency: "USD",
        cashierMemberId: "member-a2",
        handoverFromSessionId: S_USD_1,
        openedAt: new Date(),
      }),
    );
    const openUsd = await withTenantDb(ORG_A, async (db) =>
      db
        .select({ id: cashSessions.id })
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.registerId, REG_A),
            eq(cashSessions.currency, "USD"),
            eq(cashSessions.status, "open"),
          ),
        ),
    );
    expect(openUsd.map((s) => s.id)).toEqual([S_USD_3]);
  });
});

describe("RLS — tenant B is unaffected by all of the above", () => {
  it("still sees its own rows intact", async () => {
    const rows = await withTenantDb(ORG_B, async (db) =>
      db.select().from(products),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(PROD_B);
  });
});
