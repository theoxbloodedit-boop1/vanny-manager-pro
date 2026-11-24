import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "./schema";

/**
 * Database client — platform-level / migration access only.
 *
 * NOTE: this file deliberately does NOT provide tenant access. `withTenantDb()`
 * in `src/db/tenant.ts` is the ONLY sanctioned way feature code reaches tenant
 * tables (ADR-0001). Use this module for migrations, provisioning and platform
 * queries that legitimately need to cross tenants.
 */

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
let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (!db) {
    pool ??= new Pool({ connectionString: requireEnv("DATABASE_URL") });
    db = drizzle(pool, { schema });
  }
  return db;
}

export type Db = ReturnType<typeof getDb>;

/** For scripts and tests that need a clean shutdown. */
export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
