import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "./schema";

/**
 * Database client — Phase 0 scaffold.
 *
 * NOTE: this file deliberately does NOT yet provide tenant access.
 * Phase 1 adds `getTenantDb()` in `src/db/tenant.ts`, which is the ONLY way
 * feature code will reach tenant tables (ADR-0001). Until then this module is
 * used for migrations and platform-level queries only.
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
