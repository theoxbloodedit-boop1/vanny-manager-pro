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

> **Outstanding (ROADMAP 1.7b):** a CI catalog-introspection test that fails if a
> table carrying `org_id` lacks an enabled RLS policy.

## 2. Authentication & sessions — status

- Library: **Better Auth 1.7.27** (ADR-0002/0012). **Built and verified** on a real
  server: sign-up/sign-in (argon2id via the library), httpOnly `SameSite=Lax`
  **signed** session cookies, email verification, organization membership.
- The session cookie carries a **signed token** (`token.signature`); the raw token
  alone is rejected by verification. The active organization is stored
  **per-session** (`session.activeOrganizationId`) and always read server-side.
- **Email verification is enforced for invitations**: unverified emails cannot list
  or accept invitations (Better Auth org-plugin control — kept, not bypassed).
  Delivery transport is environment-dependent (ADR-0013); the verification token
  flow is always real. A dev-only endpoint
  (`GET /api/dev/verification-link`) exists for SMTP-less sandboxes and is a
  **404 in production** and for any non-`log` transport.
- We never store or log passwords, and never log signed tokens/cookies.

## 3. Authorization / RBAC — status

- **Built and verified** (ROADMAP 1.2–1.5). Two independent layers:
  - **Business** — a single `authorize()` entry point over the permission matrix
    (`src/server/rbac/permissions.ts`), always executed inside `withTenantDb`
    (RLS-scoped). No `role === "owner"` comparison exists in feature code.
  - **Org-management** — Better Auth access control (`src/server/rbac/org-roles.ts`)
    for invite / cancel / role change / delete org. A bug in one layer cannot grant
    powers of the other.
- Design principle (enforced): **never trust an `org_id` or `branch_id` from the
  client.** Every operation re-checks membership and permission server-side, and the
  active org comes from the session, not the request body.
- Branch-level access: a member only acts at branches present in `branch_access`
  (grants materialized from the invitation on accept, or granted by an admin).
  Reaching an unassigned branch yields **403, not an empty list**.
- A role change applies on the **next request** (role read from the DB per call);
  an organization can never be left without an owner (`400 LAST_OWNER`).
- Residual (honest): a literal positive+negative test for *every* one of the 33
  permissions is not yet written — matrix invariants + representative integration
  tests cover the enforcement paths (ROADMAP Gate 1, open item).

## 4. Secrets & environment

- **No secrets in the repository.** `.env.example` contains **keys only**; CI fails the
  build if any value appears (job `secrets-guard`).
- CI additionally scans **history** with gitleaks.
- Never commit credentials, API keys, or environment secrets.
- No secret-bearing `NEXT_PUBLIC_*` variable is permitted (CI-enforced).
- Database and auth values are injected from the platform (Vercel env), never from code.
- Environment variables in use (names only, see `.env.example`):
  `DATABASE_URL` (tenant role, RLS-enforced), `AUTH_DATABASE_URL`
  (schema-owner role for Better Auth; falls back to `DATABASE_URL`),
  `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `MAIL_TRANSPORT`
  (`capture` | `log` | `smtp` — ADR-0013), `NEXT_PUBLIC_APP_URL`,
  `NEXT_PUBLIC_APP_ENV`.
- **Two-role database split is load-bearing**: the application pool connects as a
  non-owner role so RLS applies; the Better Auth pool connects as the schema owner.
  Pointing both at the owner role would silently disable tenant isolation for the
  identity path — see ADR-0001/0012.

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
- **Zod** validates every request body at the API boundary
  (`onboardingSchema`, `branchBody`, `grantBody`, `inviteBody`, `cancelInviteBody`,
  `roleBody`); the `/api/auth/*` surface is validated inside the Better Auth handler.
  Invalid input returns a uniform 400 envelope; `ZodError` details are mapped to a
  short, safe message (no stack leakage to the client).
- **CSRF / XSS:** httpOnly `SameSite=Lax` signed session cookies (no JS access),
  JSON-only request bodies, and React's default escaping cover the current surface.
  The org-management endpoints are additionally gated by server-side access control,
  so a forged same-site POST cannot change roles or invite members.

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
