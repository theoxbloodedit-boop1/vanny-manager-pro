import { pgPolicy, type AnyPgColumn, type PgPolicy } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";

/**
 * Row-level security — the second layer of tenant isolation (ADR-0001).
 *
 * `current_setting('app.org_id', true)` returns NULL when the transaction has
 * not set it. `NULL = <uuid>` evaluates to NULL, so the policy filters EVERY
 * row. That is deliberate: a connection that forgot to scope itself sees
 * nothing, not someone else's data. Fail closed, always.
 *
 * `using`      governs reads, and the visibility of rows for UPDATE/DELETE.
 * `withCheck`  governs writes — a row whose org_id does not match the
 *              transaction's tenant cannot be inserted or updated into existence.
 *
 * The setting is applied with `SET LOCAL` inside a transaction, which is safe
 * under PgBouncer/Neon pooling because it reverts at commit.
 */
export function tenantIsolationPolicy(column: AnyPgColumn): PgPolicy {
  const predicate: SQL = sql`${column} = current_setting('app.org_id', true)::uuid`;
  return pgPolicy("tenant_isolation", {
    for: "all",
    using: predicate,
    withCheck: predicate,
  });
}
