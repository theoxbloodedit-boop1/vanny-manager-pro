# ADR-0001 — Shared schema with row-level security for multi-tenancy

**Status:** ACCEPTED · **Date:** 2026-11-24 · **Supersedes:** none

## Context

VANNY MANAGER PRO serves many unrelated businesses. A leak between tenants is the single
most damaging failure mode available to this product — it destroys the trust of every
customer at once, not just one. Three isolation models were considered:

| Model | Verdict |
|---|---|
| Database per tenant | Rejected — operational overhead, no benefit at this scale, hostile to serverless pooling |
| Schema per tenant | Rejected — migration fan-out, no cross-tenant analytics, painful to evolve |
| Shared schema + `org_id` + RLS | **Accepted** |

## Decision

One database, one schema. Every tenant table carries `org_id uuid NOT NULL`. Isolation is
enforced at **three** independent layers, because any single layer will eventually be
bypassed by a bug:

1. **Type system.** `getTenantDb()` is the only constructor of a query handle for tenant
   data. There is no exported `db` for tenant tables. Feature code cannot express an
   unscoped query.
2. **Row-Level Security.** `USING (org_id = current_setting('app.org_id', true)::uuid)`.
   `SET LOCAL` inside a transaction — safe on PgBouncer. `current_setting(..., true)` returns
   `NULL` when unset, and `NULL = x` filters everything → **fail-closed**.
3. **Automated tests.** Org A vs Org B across every public access path, plus a direct-SQL
   unscoped test. Merge blocker.

The runtime role `vanny_app` does **not** hold `BYPASSRLS`. The migration role does.

## Consequences

- **+** Cheap, pooled-connection friendly, one migration path, cross-tenant reporting possible
  for the platform admin surface.
- **+** A missed `org_id` filter returns an empty set, not another tenant's rows.
- **−** Every new tenant table needs its `org_id` column, its index, and its RLS policy.
  Enforced by a CI test that introspects `pg_class`/`pg_policies` and fails if a table with
  `org_id` lacks an enabled policy.
- **−** Platform admins need an explicit, audited path rather than a role flag.
- **−** `SET LOCAL` discipline is mandatory; a session-level `SET` on the pooled connection
  would leak the tenant. Code review rule: only `SET LOCAL`, only inside a transaction.

## Verification

- `tests/integration/tenant-isolation.test.ts` (T4) — merge blocker.
- `scripts/verify-rls.ts` — introspects catalog, fails on any unprotected tenant table.
- Manual fail-closed check documented in `NEON-SETUP.md` §5.
