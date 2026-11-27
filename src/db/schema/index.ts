/**
 * Schema barrel. Deliberately does NOT export a database handle —
 * tenant data access must go through `withTenantDb()` (ADR-0001).
 *
 * Exports business tables (tenant-scoped, RLS) and the Better Auth identity
 * tables (platform tables; `member`/`invitation` are also RLS-scoped).
 */
export * from "./enums";
export * from "./rls";
export * from "./org";
export * from "./catalog";
export * from "./cash";
export * from "./auth";
export * from "./platform";
export * from "./vault";
export * from "./sales";
