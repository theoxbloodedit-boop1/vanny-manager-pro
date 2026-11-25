/**
 * MIGRATION SAFETY PROOF (ADR-0014, owner review item 5).
 *
 * Executes the REAL migrations against two clean embedded PostgreSQL instances:
 *   (A) FRESH DATABASE — the FULL migration history (`0000` base schema +
 *       `0001` ADR-0014 delta), exactly as the harness/deployment applies them.
 *   (B) DATABASE WITH EXISTING USERS — the base schema (`0000`) + 3 real users
 *       already in `user`, then the ADR-0014 delta (`0001`). Proves the
 *       `ALTER TABLE user ADD COLUMN ... NOT NULL DEFAULT false` back-fills
 *       existing rows safely (no data loss) and that the append-only trigger is
 *       active on the migrated database.
 *
 * Read-only on the repo: it only reads the migration files and spins up ephemeral
 * PG instances on dedicated ports; `persistent:false` deletes their data dirs.
 *
 * Run:  node --import tsx scripts/migration-proof.mts
 */
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../src/db/migrations");

function allMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}
async function statementsOf(file: string): Promise<string[]> {
  const raw = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
  return raw.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
}
async function apply(pool: Pool, files: string[]): Promise<number> {
  let n = 0;
  for (const f of files) for (const s of await statementsOf(f)) { await pool.query(s); n++; }
  return n;
}
async function startPG(port: number, dataDir: string): Promise<{ pg: InstanceType<typeof EmbeddedPostgres>; pool: Pool }> {
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir, port, user: "postgres", password: "postgres",
    persistent: false, initdbFlags: ["--auth=trust", "--no-locale"],
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("migproof");
  return { pg, pool: new Pool({ connectionString: `postgres://postgres:postgres@127.0.0.1:${port}/migproof`, max: 4 }) };
}
const one = (r: { rows: unknown[] }): unknown => (r.rows[0] as Record<string, unknown>) ?? {};
const flat = (m: string) => m.replace(/\s+/g, " ");

async function freshCase(): Promise<void> {
  console.log("\n=== (A) FRESH DATABASE — full migration history (0000 base + 0001 delta) ===");
  const files = allMigrationFiles();
  const { pg, pool } = await startPG(55436, "/tmp/vanny-pg-migproof-fresh");
  try {
    const n = await apply(pool, files);
    console.log(`applied ${n} statements across ${files.length} migrations [${files.join(", ")}]`);

    const tables = one(await pool.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'`));
    console.log(`public tables created: ${tables.n}`);

    const col = one(await pool.query(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_name='user' AND column_name='manually_approved'`));
    console.log(`user.manually_approved -> type=${col.data_type} null=${col.is_nullable} default=${col.column_default}`);

    const trig = (await pool.query(
      `SELECT tgname FROM pg_trigger WHERE tgrelid='manual_approvals'::regclass AND NOT tgisinternal`)).rows;
    console.log(`manual_approvals triggers: ${JSON.stringify(trig)}`);

    // Functional check on the fresh DB.
    await pool.query(`INSERT INTO "user" (id,name,email,created_at,updated_at) VALUES ('u_fresh','Fresh','fresh@example.cd',now(),now())`);
    await pool.query(`INSERT INTO manual_approvals (id,user_id,operator_id,action,reason,operation_id,created_at)
                      VALUES (gen_random_uuid(),'u_fresh','op-fresh','approve','r',gen_random_uuid(),now())`);
    let upd = "NO ERROR (BAD)";
    try { await pool.query(`UPDATE manual_approvals SET reason='x' WHERE user_id='u_fresh'`); }
    catch (e) { upd = (e as Error).message; }
    console.log(`append-only check (fresh): UPDATE -> ${flat(upd)}`);
  } finally {
    await pool.end(); await pg.stop();
  }
}

async function existingUsersCase(): Promise<void> {
  console.log("\n=== (B) DATABASE WITH EXISTING USERS — base (0000) + users, then ADR-0014 (0001) ===");
  const files = allMigrationFiles();
  const base = files.filter((f) => f.startsWith("0000"));
  const delta = files.filter((f) => !f.startsWith("0000")); // 0001 + 0002 (ADR-0014)
  const { pg, pool } = await startPG(55437, "/tmp/vanny-pg-migproof-existing");
  try {
    // Production path step 1: base schema already migrated.
    const nb = await apply(pool, base);
    console.log(`base schema applied (${nb} statements)`);

    // Step 2: real users already exist in `user` (email_verified=false).
    for (const [id, email] of [
      ["u1", "alice@existing.cd"], ["u2", "bob@existing.cd"], ["u3", "carol@existing.cd"],
    ] as const) {
      await pool.query(`INSERT INTO "user" (id,name,email,created_at,updated_at) VALUES ($1,$1,$2,now(),now())`, [id, email]);
    }
    console.log(`existing users inserted: 3 (email_verified defaults to false)`);

    // Step 3: apply the ADR-0014 delta (0001) on top.
    const nd = await apply(pool, delta);
    console.log(`ADR-0014 + hardening delta applied (${nd} statements: approvals, operator-token ledgers, triggers)`);

    // Verify existing rows back-filled to false (no data loss, no forced verification).
    const after = (await pool.query(`SELECT email, manually_approved, email_verified FROM "user" ORDER BY email`)).rows;
    console.log(`after migration: ${after.map((r) => `${r.email} manually_approved=${r.manually_approved} email_verified=${r.email_verified}`).join(" | ")}`);
    const ok = after.length === 3 && after.every((r) => r.manually_approved === false && r.email_verified === false);
    console.log(`existing rows preserved & back-filled to false: ${ok ? "YES" : "NO (BAD)"}`);

    // Append-only active on the migrated DB too.
    await pool.query(`INSERT INTO manual_approvals (id,user_id,operator_id,action,reason,operation_id,created_at)
                      VALUES (gen_random_uuid(),'u2','op-2','approve','r',gen_random_uuid(),now())`);
    let del = "NO ERROR (BAD)";
    try { await pool.query(`DELETE FROM manual_approvals WHERE user_id='u2'`); }
    catch (e) { del = (e as Error).message; }
    console.log(`append-only check (existing): DELETE -> ${flat(del)}`);
  } finally {
    await pool.end(); await pg.stop();
  }
}

try {
  await freshCase();
  await existingUsersCase();
  console.log("\n=== MIGRATION SAFETY PROOF COMPLETE ===");
} catch (e) {
  console.error("PROOF FAILED:", e);
  process.exitCode = 1;
}
