import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { urlsFor, startPostgres, stopPostgres, seed } from "./pg-harness";
import {
  withTenantDb,
  getTenantPool,
  closeTenantPool,
} from "../../src/db/tenant";
import { products } from "../../src/db/schema";

/**
 * TENANT CONTEXT — transaction-local `app.org_id` (CTO blocking correction).
 *
 * `set_config('app.org_id', $1, TRUE)` is TRANSACTION-LOCAL: PostgreSQL reverts
 * the setting at COMMIT or ROLLBACK. With `FALSE` the setting is SESSION-level
 * and persists on the recycled pooled connection — a query that forgot to
 * scope itself would then read a STALE tenant's rows instead of failing closed.
 *
 * These tests run on a REAL PostgreSQL server (19.0) with a pool of ONE
 * connection, so every checkout is literally the SAME physical client — the
 * exact PgBouncer/Neon connection-recycle scenario.
 *
 * PG19 note (ADR-0014 §13): at COMMIT/ROLLBACK a transaction-local custom
 * setting reverts to '' (empty string), not NULL. The RLS predicate
 * NULLIF(current_setting(...), '') normalizes both to "no tenant" → zero rows.
 * The CONTRACT asserted here: after the transaction, the tenant context is no
 * longer active, and an unscoped transaction sees NOTHING (zero rows, no error).
 *
 *   1. Org A: set the context, run a query, COMMIT.
 *   2. Same client reused: the A context is no longer active.
 *   3. Same for ROLLBACK.
 *   4. Org A data is unreachable from an unscoped transaction, or from B.
 */

const ORG_A = "11111111-2222-4333-8444-555555555555";
const ORG_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BR_A = "11111111-2222-4333-8444-666666666666";
const PROD_A = "11111111-2222-4333-8444-888888888888";
const PROD_B = "aaaaaaaa-bbbb-4ccc-8ddd-111111111111";

let admin: Pool;
const { APP_URL } = urlsFor("context");

/**
 * The tenant context is "no longer active" when the GUC is no longer ORG_A.
 * On PG19 a transaction-local setting reverts to '' (empty string); on older
 * servers it reverts to NULL. Both are acceptable; ORG_A is NOT.
 */
function contextCleared(v: unknown): boolean {
  return v === null || v === "";
}

beforeAll(async () => {
  admin = await startPostgres("context");
  admin.on("error", () => {}); // swallow 57P01 teardown notices
  const c = await admin.connect();
  try {
    await seed.org(c, ORG_A, "Ctx Alpha", "boutique");
    await seed.org(c, ORG_B, "Ctx Oméga", "bar");
    await seed.branch(c, BR_A, ORG_A, "Centre");
    await seed.product(c, PROD_A, ORG_A, "Montures acétate");
    await seed.product(c, PROD_B, ORG_B, "Bière artisanale 33cl");
  } finally {
    c.release();
  }
  // A pool of ONE: every sequential checkout is the SAME physical connection.
  // Must be set before the tenant pool is first created.
  process.env.DATABASE_POOL_MAX = "1";
  process.env.DATABASE_URL = APP_URL;
  // Swallow 57P01 (server-shutdown) on idle clients during teardown.
  getTenantPool().on("error", () => {});
}, 120_000);

afterAll(async () => {
  await closeTenantPool().catch(() => {});
  if (admin) await stopPostgres(admin);
});

describe("tenant context — transaction-local scoping on a REUSED client", () => {
  it("1. org A: set the context, run a query, COMMIT (via withTenantDb)", async () => {
    const rows = await withTenantDb(ORG_A, (db) => db.select().from(products));
    expect(rows.map((r) => r.id)).toEqual([PROD_A]);
  });

  it("2. the SAME client reused after COMMIT no longer carries org A's context", async () => {
    const pool = getTenantPool();
    // max=1 ⇒ the pool can hold exactly one client: the one withTenantDb used.
    const c1 = await pool.connect();
    c1.release();
    const c2 = await pool.connect();
    try {
      expect(c2).toBe(c1); // the SAME physical connection is recycled
      const { rows } = await c2.query(
        `SELECT current_setting('app.org_id', true) AS v`,
      );
      // The A context must be gone (NULL or '' — never ORG_A).
      expect(contextCleared(rows[0]?.v)).toBe(true);
      expect(rows[0]?.v).not.toBe(ORG_A);
    } finally {
      c2.release();
    }
  });

  it("3. an UNSCOPED transaction on the reused client sees NOTHING (fail closed)", async () => {
    // THE regression that is_local=false allowed: a request that forgot to set
    // the context would inherit org A's STALE session setting and read A's rows.
    const c = await getTenantPool().connect();
    try {
      await c.query("BEGIN");
      try {
        const byId = await c.query(
          `SELECT count(*)::int AS n FROM products WHERE id = $1`,
          [PROD_A],
        );
        expect(byId.rows[0].n).toBe(0);
        const all = await c.query(`SELECT count(*)::int AS n FROM products`);
        expect(all.rows[0].n).toBe(0);
      } finally {
        await c.query("ROLLBACK");
      }
    } finally {
      c.release();
    }
  });

  it("4. is_local=true: visible INSIDE the transaction, cleared after COMMIT", async () => {
    const c = await getTenantPool().connect();
    try {
      await c.query("BEGIN");
      try {
        await c.query(`SELECT set_config('app.org_id', $1, true)`, [ORG_A]);
        const inTxn = await c.query(
          `SELECT current_setting('app.org_id', true) AS v`,
        );
        expect(inTxn.rows[0].v).toBe(ORG_A); // scoped read works inside the txn
        const scoped = await c.query(`SELECT count(*)::int AS n FROM products`);
        expect(scoped.rows[0].n).toBe(1);
        await c.query("COMMIT");
      } finally {
        // If COMMIT was not reached, leave the client in a clean state.
        await c.query("ROLLBACK").catch(() => {});
      }
      const after = await c.query(
        `SELECT current_setting('app.org_id', true) AS v`,
      );
      expect(contextCleared(after.rows[0].v)).toBe(true);
      expect(after.rows[0].v).not.toBe(ORG_A);
    } finally {
      c.release();
    }
  });

  it("5. same guarantee after ROLLBACK", async () => {
    const c = await getTenantPool().connect();
    try {
      await c.query("BEGIN");
      try {
        await c.query(`SELECT set_config('app.org_id', $1, true)`, [ORG_A]);
        const inTxn = await c.query(
          `SELECT current_setting('app.org_id', true) AS v`,
        );
        expect(inTxn.rows[0].v).toBe(ORG_A);
        await c.query("ROLLBACK");
      } finally {
        await c.query("ROLLBACK").catch(() => {});
      }
      const after = await c.query(
        `SELECT current_setting('app.org_id', true) AS v`,
      );
      expect(contextCleared(after.rows[0].v)).toBe(true);
      expect(after.rows[0].v).not.toBe(ORG_A);
      // And the very next unscoped transaction still sees nothing.
      await c.query("BEGIN");
      try {
        const n = await c.query(`SELECT count(*)::int AS n FROM products`);
        expect(n.rows[0].n).toBe(0);
      } finally {
        await c.query("ROLLBACK").catch(() => {});
      }
    } finally {
      c.release();
    }
  });

  it("6. org B on the same recycled client sees only B — never A", async () => {
    const rowsB = await withTenantDb(ORG_B, (db) => db.select().from(products));
    expect(rowsB.map((r) => r.id)).toEqual([PROD_B]);
    const cross = await withTenantDb(
      ORG_B,
      (db) => db.select().from(products).where(eq(products.id, PROD_A)),
    );
    expect(cross).toHaveLength(0);
  });
});
