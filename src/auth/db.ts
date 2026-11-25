import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../db/schema";

/**
 * Database connection for Better Auth — see ADR-0012.
 *
 * Better Auth must connect with the SCHEMA-OWNER role (the same role that
 * applies migrations), because it writes to `member` and `invitation`, which
 * are RLS-protected: a tenant-scoped role without `app.org_id` set would be
 * rejected by the RLS `WITH CHECK` clause.
 *
 *   AUTH_DATABASE_URL  → owner/direct role (migrations + Better Auth)
 *   DATABASE_URL       → tenant role, RLS-enforced (business queries only)
 *
 * If AUTH_DATABASE_URL is unset, DATABASE_URL is used — which is correct in
 * environments where a single role is used for everything, and WRONG (loudly)
 * in a split-role deployment. Tests set both explicitly.
 */
export type AuthDb = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let db: AuthDb | undefined;

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

export function getAuthDb(): AuthDb {
  if (!db) {
    const connectionString =
      process.env.AUTH_DATABASE_URL && process.env.AUTH_DATABASE_URL.length > 0
        ? process.env.AUTH_DATABASE_URL
        : requireEnv("DATABASE_URL");
    pool = new Pool({
      connectionString,
      max: Number(process.env.AUTH_POOL_MAX ?? 5),
      connectionTimeoutMillis: 10_000,
    });
    db = drizzle(pool, { schema }) as AuthDb;
  }
  return db;
}

/** For scripts and tests that need a clean shutdown. */
export async function closeAuthDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
