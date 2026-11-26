# ADR-0011 — Real-PostgreSQL integration tests via embedded-postgres

**Status:** ACCEPTED · **Date:** 2026-11-24 · **Supersedes:** none

## Context

Phase 0 shipped the schema and the RLS policies as generated SQL, but nothing had
executed that SQL against a live database. The CTO review forbids claiming completion
without proof, and the security properties that justify the whole architecture (RLS
tenant isolation, the composite price FK, the one-open-session-per-(register, currency)
invariant) are **database-enforced**, not application-enforced. A mocked `pg` pool
proves the test passes; only a real server proves the security works.

## Decision

Integration tests run a **real PostgreSQL server** started in-process by
`embedded-postgres` (dev dependency), on port 55433 with `--auth=trust`, bound to
localhost, data dir under `/tmp`, deleted on stop. No secrets, no external service, no
Docker requirement.

Topology mirrors production (ADR-0001):

| Role | Purpose | RLS |
|---|---|---|
| `postgres` | owns the schema, applies migrations, seeds data | **bypasses** (table owner) |
| `tenant_app` | the role `withTenantDb` connects as | **enforced** |

The harness (`tests/integration/pg-harness.ts`) applies the **real generated migration
files** from `src/db/migrations/`, so a broken migration fails CI instead of failing a
customer's deploy.

## Consequences

- **+** RLS, FKs and partial unique indexes are now *proven*, not assumed.
- **+** Migration ordering bugs (e.g. FK before its backing unique constraint) fail in CI.
- **+** No secrets or external dependencies; runs in the sandbox and in GitHub Actions.
- **−** One more dev dependency (`embedded-postgres`, `pg`, `@types/pg`); the binary is a
  platform artifact (`@embedded-postgres/linux-x64`) that must be allowed in
  `pnpm.onlyBuiltDependencies`.
- **−** Port 55433 is fixed; two parallel `pnpm test:integration` runs on one host collide.
  Acceptable for CI (single runner) and local development.
- **−** `persistent: false` means the data dir is deleted on stop — tests must be
  idempotent and must not assume state across runs.

## Verification

- `pnpm test:integration` — 11 passing tests on a real PostgreSQL (see ADR-0001).
- CI job `test-integration` in `.github/workflows/ci.yml`, wired into the `ci-ok` gate.
