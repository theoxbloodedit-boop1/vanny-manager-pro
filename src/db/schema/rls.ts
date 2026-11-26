import { pgPolicy, type AnyPgColumn, type PgPolicy } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";

/**
 * Row-level security — the second layer of tenant isolation (ADR-0001).
 *
 * `current_setting('app.org_id', true)` returns NULL when the session/transaction
 * has not set it. `NULL = <uuid>` evaluates to NULL, so the policy filters EVERY
 * row. That is deliberate: a connection that forgot to scope itself sees
 * nothing, not someone else's data. Fail closed, always.
 *
 * `NULLIF(..., '')` — PostgreSQL 19 (this product's target, 19.0) restores a
 * TRANSACTION-LOCAL custom setting to an EMPTY STRING (not NULL) at
 * COMMIT/ROLLBACK. Without NULLIF, `''::uuid` would raise 22P02 on any
 * unscoped RLS read instead of failing closed with zero rows. NULLIF normalizes
 * both the NULL and the '' states to "no tenant in context" (proven by
 * tests/integration/tenant-context.test.ts). See ADR-0014 §13.
 *
 * `using`      governs reads, and the visibility of rows for UPDATE/DELETE.
 * `withCheck`  governs writes — a row whose org_id does not match the
 *              transaction's tenant cannot be inserted or updated into existence.
 *
 * The setting is applied with `set_config(..., true)` (transaction-local)
 * inside a transaction, which is safe under PgBouncer/Neon pooled connections
 * because it reverts at COMMIT or ROLLBACK.
 */
export function tenantIsolationPolicy(column: AnyPgColumn): PgPolicy {
  const predicate: SQL = sql`${column} = NULLIF(current_setting('app.org_id', true), '')::uuid`;
  return pgPolicy("tenant_isolation", {
    for: "all",
    using: predicate,
    withCheck: predicate,
  });
}
