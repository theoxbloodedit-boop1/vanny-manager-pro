/**
 * Local dev database bootstrap — starts a REAL PostgreSQL (embedded) on
 * port 55432, applies the generated migrations as the schema owner, and
 * creates the tenant application role (NOBYPASSRLS, same topology as
 * production, ADR-0001). Keeps running until killed.
 *
 *   corepack pnpm tsx scripts/bootstrap-dev-db.mts
 */
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";

const PORT = 55432;
const DATA_DIR = "/home/user/.vanny-dev-pg";
const ADMIN_URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/vanny`;

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  port: PORT,
  user: "postgres",
  password: "postgres",
  persistent: true,
  initdbFlags: ["--auth=trust", "--no-locale"],
});

try {
  await pg.initialise();
} catch {
  console.log("[dev-db] cluster already initialised — reusing it");
}
await pg.start();

// Create the database from the default `postgres` db (a Pool can only
// connect to databases that already exist).
const bootstrap = new Pool({
  connectionString: `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});
const { rows } = await bootstrap.query(
  `SELECT 1 FROM pg_database WHERE datname = 'vanny'`,
);
if (rows.length === 0) {
  await bootstrap.query(`CREATE DATABASE vanny`);
  console.log("[dev-db] created database vanny");
} else {
  console.log("[dev-db] database vanny already exists");
}
await bootstrap.end();

const admin = new Pool({ connectionString: ADMIN_URL, max: 4 });

// Migrations, as the schema owner (bypasses RLS — like provisioning).
const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/db/migrations",
);
const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
for (const file of files) {
  const raw = await readFile(path.join(migrationsDir, file), "utf8");
  const statements = raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await admin.query(stmt);
  }
  console.log(`[dev-db] applied ${file}`);
}

// Application role: NOT the owner → RLS applies to its connections.
try {
  await admin.query(
    `CREATE ROLE tenant_app LOGIN
       PASSWORD 'tenant_app_pw'
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
  );
} catch {
  console.log("[dev-db] role tenant_app already exists");
}
await admin.query(`GRANT USAGE ON SCHEMA public TO tenant_app`);
await admin.query(
  `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tenant_app`,
);
await admin.query(
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tenant_app`,
);

await admin.end();
console.log(`[dev-db] READY on 127.0.0.1:${PORT} (db: vanny)`);
console.log("[dev-db] keeping the server alive — Ctrl+C to stop.");

// Keep the process alive.
setInterval(() => {}, 1 << 30);
process.on("SIGINT", async () => {
  await pg.stop(true);
  process.exit(0);
});
