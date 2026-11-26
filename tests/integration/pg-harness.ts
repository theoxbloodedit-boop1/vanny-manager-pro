import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Pool, type PoolClient } from "pg";

/**
 * Integration test harness — a REAL PostgreSQL instance.
 *
 * Why: RLS, foreign keys and partial unique indexes only have meaning when a
 * real database enforces them. A mocked pool would prove the test passes,
 * not that the security works.
 *
 * Roles (mirrors production topology, ADR-0001):
 *   postgres   — owns the schema (runs migrations). Bypasses RLS. Admin only.
 *   tenant_app — the role the application connects as. Not owner, not superuser:
 *                RLS is enforced on its connections.
 */

/**
 * Each suite gets its own server (port + data dir) so suites can run in
 * parallel. `startPostgres("isolation")` and `startPostgres("auth")` never
 * touch the same files.
 */
export type SuiteName =
  | "isolation"
  | "auth"
  | "approvals"
  | "context"
  | "phone"
  | "scratch"
  | "reconnect";

const PORTS: Record<string, number> = {
  isolation: 55433,
  auth: 55434,
  approvals: 55435,
  context: 55436,
  phone: 55437,
  scratch: 55438,
  reconnect: 55439,
};
const DATA_DIRS: Record<string, string> = {
  isolation: "/tmp/vanny-pg-integration",
  auth: "/tmp/vanny-pg-auth",
  approvals: "/tmp/vanny-pg-approvals",
  context: "/tmp/vanny-pg-context",
  phone: "/tmp/vanny-pg-phone",
  scratch: "/tmp/vanny-pg-scratch",
  reconnect: "/tmp/vanny-pg-reconnect",
};

export interface HarnessUrls {
  ADMIN_URL: string;
  APP_URL: string;
}

export function urlsFor(suite: SuiteName): HarnessUrls {
  const port = PORTS[suite];
  return {
    ADMIN_URL: `postgres://postgres:postgres@127.0.0.1:${port}/vanny_integ`,
    APP_URL: `postgres://tenant_app:tenant_app_pw@127.0.0.1:${port}/vanny_integ`,
  };
}

// Backwards-compatible exports for the isolation suite.
export const PG_PORT = PORTS.isolation;
export const { ADMIN_URL, APP_URL } = urlsFor("isolation");

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/db/migrations",
);

let instance: InstanceType<typeof EmbeddedPostgres> | undefined;

export async function startPostgres(suite: SuiteName = "isolation"): Promise<Pool> {
  const { ADMIN_URL: adminUrl } = urlsFor(suite);
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIRS[suite]!,
    port: PORTS[suite]!,
    user: "postgres",
    password: "postgres",
    persistent: false, // deletes the data dir on stop — tests must be repeatable
    initdbFlags: ["--auth=trust", "--no-locale"],
  });
  instance = pg;
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("vanny_integ");

  const admin = new Pool({ connectionString: adminUrl, max: 4 });

  // 1. Apply the real generated migrations, as the schema owner.
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const raw = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const statements = raw
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await admin.query(stmt);
    }
  }

  // 2. Create the application role: deliberately NOT the table owner,
  //    so every tenant table's RLS policy applies to its connections.
  await admin.query(
    `CREATE ROLE tenant_app LOGIN
       PASSWORD 'tenant_app_pw'
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
  );
  await admin.query(`GRANT USAGE ON SCHEMA public TO tenant_app`);
  await admin.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tenant_app`,
  );
  await admin.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tenant_app`,
  );

  return admin;
}

export async function stopPostgres(admin: Pool): Promise<void> {
  await admin.end();
  await instance?.stop();
  instance = undefined;
}

/** Seed helpers run as the OWNER (RLS-bypassing) — like provisioning. */
export const seed = {
  async org(client: PoolClient, id: string, name: string, sector: string) {
    await client.query(
      `INSERT INTO organizations (id, name, slug, business_sector)
       VALUES ($1, $2, $3, $4)`,
      [id, name, name.toLowerCase().replace(/\s+/g, "-"), sector],
    );
  },
  async branch(client: PoolClient, id: string, orgId: string, name: string) {
    await client.query(
      `INSERT INTO branches (id, org_id, name) VALUES ($1, $2, $3)`,
      [id, orgId, name],
    );
  },
  async register(
    client: PoolClient,
    id: string,
    orgId: string,
    branchId: string,
    code: string,
  ) {
    await client.query(
      `INSERT INTO cash_registers (id, org_id, branch_id, name, code)
       VALUES ($1, $2, $3, $4, $4)`,
      [id, orgId, branchId, code],
    );
  },
  async product(client: PoolClient, id: string, orgId: string, name: string) {
    await client.query(
      `INSERT INTO products (id, org_id, name, sku) VALUES ($1, $2, $3, $4)`,
      [id, orgId, name, `SKU-${name}`],
    );
  },
  async price(
    client: PoolClient,
    productId: string,
    orgId: string,
    currency: "USD" | "CDF",
    amount: number,
  ) {
    await client.query(
      `INSERT INTO product_prices (product_id, org_id, currency, amount_minor)
       VALUES ($1, $2, $3, $4)`,
      [productId, orgId, currency, amount],
    );
  },
};
