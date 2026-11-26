import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "./schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Tenant-scoped data access — the ONLY sanctioned way feature code reaches
 * tenant tables (ADR-0001).
 *
 * Mechanism
 * ---------
 * 1. Every call runs inside a single transaction on one pooled client.
 * 2. `set_config('app.org_id', $1, false)` scopes that transaction. The
 *    third argument (false) makes the setting LOCAL: it reverts at COMMIT or
 *    ROLLBACK, so a leaked setting can never bleed into another request —
 *    this is what keeps it safe under PgBouncer / Neon pooled connections.
 * 3. The RLS policies generated in `src/db/schema/rls.ts` compare every row
 *    against `current_setting('app.org_id', true)`. Unscoped ⇒ NULL ⇒ no rows.
 *    Fail closed.
 *
 * The application connects with a role that is NOT the table owner and NOT a
 * superuser, so RLS is enforced on its connections. The owner role (used by
 * migrations) bypasses RLS by design — see `tests/integration/isolation.test.ts`
 * which proves the distinction.
 *
 * Usage
 * -----
 *   const db = await withTenantDb(orgId, async (tenant) => {
 *     return tenant.select().from(products);
 *   });
 *
 * Do NOT construct a Drizzle client directly against the pool in feature code.
 * `getDb()` in `client.ts` is reserved for platform-level / migration work.
 */
export type TenantDb = NodePgDatabase<typeof schema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        "Copy .env.example to .env.local and fill it in.",
    );
  }
  return value;
}

let pool: Pool | undefined;

export function getTenantPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: requireEnv("DATABASE_URL"),
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      // Neon's pooler expects short-lived, idle-reaped connections.
      idleTimeoutMillis: Number(process.env.DATABASE_IDLE_MS ?? 30_000),
      connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_MS ?? 10_000),
    });
  }
  return pool;
}

/** For scripts and tests that need a clean shutdown. */
export async function closeTenantPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/**
 * Run `fn` with a Drizzle client that can only see `orgId`'s rows.
 * The work is committed atomically; any error rolls everything back.
 */
export async function withTenantDb<T>(
  orgId: string,
  fn: (db: TenantDb, client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(orgId)) {
    // Fail fast, and loudly: an invalid org id is a programming bug, not data.
    throw new Error(`withTenantDb: invalid organization id: ${orgId}`);
  }
  const client = await getTenantPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.org_id', $1, false)", [orgId]);
    const db = drizzle(client, { schema }) as TenantDb;
    const result = await fn(db, client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      /* connection may be gone; release will handle it */
    });
    throw err;
  } finally {
    client.release();
  }
}
