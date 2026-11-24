# SECURITY.md — VANNY MANAGER PRO

Security is a product requirement, not a feature. This document states the model,
the controls that are **implemented and tested** today, and the controls that are
**designed but not yet built**. Anything not implemented is labelled as such — we
never advertise a control that does not exist.

## 1. Multi-tenant isolation (the highest-severity risk)

A leak between unrelated businesses destroys all customer trust at once. Isolation is
enforced at three independent layers (ADR-0001); any single layer can be bypassed by a
bug, so we rely on all three.

| Layer | Mechanism | Status |
|---|---|---|
| Type system | `withTenantDb(orgId, fn)` is the only sanctioned tenant data path. Feature code cannot express an unscoped tenant query. | **Implemented** |
| Row-Level Security | One `tenant_isolation` policy per table: `USING`/`WITH CHECK` against `current_setting('app.org_id', true)`. Unset ⇒ `NULL` ⇒ **fail-closed** (0 rows). `SET LOCAL` only — reverts at commit, safe on PgBouncer/Neon pooling. | **Implemented + tested** |
| Automated tests | Real-PostgreSQL suite: Org A vs Org B across read/write/delete, unscoped fail-closed on every table, composite-FK tenant integrity, owner-role control. | **Implemented + tested** (13 tests) |

The runtime role is **not** the table owner and does **not** hold `BYPASSRLS`; only the
migration role does. Proven in `tests/integration/isolation.test.ts`.

> **Outstanding (tracked, Phase 1b):** a CI catalog-introspection test that fails if a
> table carrying `org_id` lacks an enabled RLS policy.

## 2. Authentication & sessions — status

- Library: **Better Auth** (ADR-0002). Organization + custom-role support confirmed at
  compile level.
- **Not yet built:** the running login/org/invite flow (needs a provisioned database —
  a Phase 1 task, ADR/ROADMAP 0.11). No auth endpoint exists in the current build.
- Passwords will be hashed by the library's standard (argon2id); we will never store
  passwords in clear text or log them.

## 3. Authorization / RBAC — status

- **Not yet built.** The permission matrix and `authorize()` guard are the next Phase 1
  deliverable (ROADMAP 1.2). Until it exists, no role enforcement is claimed.
- Design principle: **never trust an `org_id` or `branch_id` from the client.** Every
  sensitive operation re-checks the caller's membership and permission server-side,
  independently of the RLS scope.

## 4. Secrets & environment

- **No secrets in the repository.** `.env.example` contains **keys only**; CI fails the
  build if any value appears (job `secrets-guard`).
- CI additionally scans **history** with gitleaks.
- Never commit credentials, API keys, or environment secrets.
- No secret-bearing `NEXT_PUBLIC_*` variable is permitted (CI-enforced).
- Database and auth values are injected from the platform (Vercel env), never from code.

## 5. Data integrity

- **Append-only financial & inventory ledgers** (ADR-0004): a validated sale is never
  silently deleted or mutated; corrections create compensating, audited entries.
- **Exact money:** integer minor units (`bigint`) only; no binary floats in monetary
  math (`src/lib/money.ts`, unit-tested).
- **Dual currency:** independent USD/CDF prices in a normalized table (ADR-0005); a
  missing price blocks the sale with an explicit error — never a silent conversion.
- **Cash invariants** (ADR-0006): at most one open session per (register, currency),
  enforced by a partial unique index and proven by test.

## 6. Input & injection

- **Drizzle ORM** parameterizes all queries; no string-built SQL in the data path.
- **Zod** validates untrusted input at every API boundary (to be added with the API
  layer).
- **CSRF / XSS:** framework defaults + library mechanisms applied as the API and auth
  surfaces are built; re-verified at that stage.

## 7. Reporting vulnerabilities

- Do not open a public issue for a security concern.
- Report privately to the owner (see repository owner) with reproduction steps.
- We triage, fix, and disclose responsibly.

## 8. Compliance (DRC) — to verify before commercial launch

Local obligations to **verify** with a qualified advisor before launch: data-protection
/ privacy requirements, e-invoicing / tax reporting, and sector-specific rules
(pharmacy traceability, where applicable). These are listed as **obligations to check**,
not as implemented guarantees.

---

*Updated 2026-11-24 (Phase 1a: RLS implemented and proven on a real PostgreSQL server).*
