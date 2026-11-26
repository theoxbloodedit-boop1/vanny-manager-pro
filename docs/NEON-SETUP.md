# VANNY MANAGER PRO — Neon Provisioning Guide

> Status: **instructions only — no database has been created.** No credentials exist yet.

---

## 1. Create the project

1. Sign in at `https://console.neon.tech` → **New Project**.
2. **Name:** `vanny-manager-pro`
3. **Postgres version:** latest stable (17+).
4. **Region:** see §2 — this decision is hard to reverse.

### Region choice (measure, don't guess)

| Region | Approx. RTT from Lubumbashi/Fungurume | Notes |
|---|---|---|
| `af-south-1` Cape Town | ~50–90 ms | Best if offered on your plan — **verify first** |
| `eu-west-1` Ireland | ~180–220 ms | Safe default, mature |
| `eu-central-1` Frankfurt | ~200–260 ms | Acceptable fallback |

**Phase 0 action:** create the project in the best available region, then measure actual
query latency from the deployment region with `EXPLAIN ANALYZE` on a trivial query. If
round-trip exceeds 300 ms, revisit before Phase 1.

---

## 2. Connection strings

Neon gives two URLs. **Use both, for different jobs.**

| Variable | Neon tab | Used for | Why |
|---|---|---|---|
| `DATABASE_URL` | **Pooled** (PgBouncer) | Runtime queries from Vercel functions | Serverless needs pooling |
| `DIRECT_URL` | **Direct** | Migrations, `drizzle-kit` | DDL and `SET` need a real session |

Both must end with `?sslmode=require`.

> RLS uses `SET LOCAL app.org_id` **inside a transaction**, which is safe on the pooled
> connection. It would *not* be safe as a session-level `SET` — never use `SET` without
> `LOCAL` on `DATABASE_URL`.

---

## 3. Database roles

Neon's default role is the project owner and can do anything, including `BYPASSRLS`.
Do **not** use it at runtime.

Run in the Neon SQL Editor:

```sql
-- 1. Runtime role: DML only, RLS enforced
CREATE ROLE vanny_app LOGIN PASSWORD '«generate-a-long-random-value»';
GRANT CONNECT ON DATABASE neondb TO vanny_app;
GRANT USAGE ON SCHEMA public TO vanny_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vanny_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vanny_app;
REVOKE ALL ON FUNCTION pg_sleep FROM PUBLIC;  -- hardening, optional
```

| Role | Used by | DDL | RLS |
|---|---|:--:|---|
| `vanny_owner` (Neon default) | migrations via `DIRECT_URL` | ✅ | bypass |
| `vanny_app` | runtime via `DATABASE_URL` | ❌ | **enforced** |

`vanny_app` must **not** have `BYPASSRLS`. Verify:

```sql
SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname LIKE 'vanny%';
-- expected: vanny_app | f | f
```

---

## 4. Extensions

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid (PG13+ has it built in)
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy product/customer search
CREATE EXTENSION IF NOT EXISTS unaccent;   -- accent-insensitive French search
```

---

## 5. Row-Level Security

Enable per tenant table, with a policy driven by a transaction-local setting:

```sql
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_tenant_isolation ON sales
  USING (org_id = current_setting('app.org_id', true)::uuid);
```

Repeat for every table carrying `org_id`: `branches`, `products`, `categories`,
`branch_stock`, `stock_movements`, `customers`, `sale_items`, `payments`, `expenses`,
`cash_sessions`, `audit_log`, `devices`, `fx_rate_history`.

`current_setting('app.org_id', true)` returns `NULL` when unset, and `NULL = x` is `NULL`
→ the policy filters everything out. **That is the desired fail-closed behaviour.**

### Verify fail-closed

```sql
SET ROLE vanny_app;
SELECT count(*) FROM sales;   -- must be 0
RESET ROLE;
```

### Application side

Every tenant transaction wraps:

```sql
BEGIN;
SET LOCAL app.org_id = '«uuid»';
-- queries
COMMIT;
```

`SET LOCAL` reverts at commit — mandatory under PgBouncer.

---

## 6. Branching strategy

| Neon branch | Purpose | Lifetime |
|---|---|---|
| `main` | **production data** | permanent |
| `develop` | staging / preview | permanent |
| `preview/pr-<n>` | integration tests per PR | deleted on merge |

Rules:
- **Never** run destructive tests against `main`.
- Preview branches are created from `main` by CI and dropped automatically.
- Schema-only resets on preview branches; no production data copied.

---

## 7. Migrations

```bash
# local: edit src/db/schema/*.ts
pnpm db:generate            # drizzle-kit generate → SQL in src/db/migrations/
git add src/db/migrations   # review the SQL diff in the PR

# CI (against a Neon preview branch, using DIRECT_URL)
pnpm db:migrate
```

**Rules:**
- Generated SQL is committed and reviewed like source code.
- **`drizzle-kit push` is forbidden** in CI and production.
- Every migration is forward-only and safe to re-run on a branch.
- Destructive changes require a two-phase migration (add new → backfill → drop old, later).

---

## 8. Backup and restore drill (test T6)

Neon provides point-in-time restore. **A backup that has never been restored is a rumour.**

Drill procedure — run before launch, then quarterly:

```bash
# 1. Pick a timestamp before a known transaction
# 2. Restore into a NEW branch, never over main
neonctl branches create --name restore-drill --restore-to "2026-11-24T10:00:00Z"

# 3. Compare against source
psql "$SOURCE_URL"  -c "select count(*), sum(total_minor) from sales" > before.txt
psql "$RESTORE_URL" -c "select count(*), sum(total_minor) from sales" > after.txt
diff before.txt after.txt   # must be identical

# 4. Record duration and drop the branch
```

**Pass criteria:** row counts and financial totals match exactly; restore time documented;
the drill is written up in `docs/drills/`.

---

## 9. Checklist before Phase 1

- [ ] Neon project created in the chosen region
- [ ] `vanny_app` role created; `rolbypassrls = false`
- [ ] `DATABASE_URL` and `DIRECT_URL` stored in Vercel (Production + Preview) **and** locally in `.env` (gitignored)
- [ ] Extensions installed
- [ ] RLS enabled on all tenant tables; fail-closed verified
- [ ] Migration applied to a preview branch
- [ ] Latency measured and recorded
- [ ] First restore drill scheduled

> Until the first four items are done, **the Phase-0 DB gate remains open.** This is the only
> Phase-0 criterion that cannot be closed from this sandbox.
