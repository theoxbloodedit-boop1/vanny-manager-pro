# ADR-0012 — Better Auth organization plugin as the identity & tenancy layer

**Status:** ACCEPTED · **Date:** 2026-11-25 · **Supersedes:** none (implements ADR-0002)

## Context

ADR-0002 chose Better Auth + its organization plugin. Phase 1b implements it.
Open questions: (1) which tables belong to the identity layer vs the tenant layer;
(2) who owns `member`/`invitation`; (3) how organization ids are generated;
(4) how org-management powers are separated from business permissions.

Verified against the installed **better-auth 1.7.27** dist (not the docs — they
lag the release):

- The org plugin's drizzle schema maps `organization → organizations`,
  `member → member`, `invitation → invitation` (our table names).
- The plugin writes `session.activeOrganizationId` (session-level, not
  user-level) — the `session` table **must** carry that uuid column
  (FK → organizations, `ON DELETE SET NULL`).
- The plugin mints its own ids (cuids) unless `beforeCreateOrganization`
  supplies one (adapter insert uses `forceAllowId: true`).
- Invitation acceptance is gated on **session email matching the invitation
  email** and the user's email being **verified**.
- `createInvitation`/`cancelInvitation`/`updateMemberRole` are enforced by the
  plugin's own access control (`ac` + `roles`), separate from our business
  matrix.

## Decision

1. **Identity tables are platform tables, not tenant tables.**
   `user`, `session`, `account`, `verification`, `organization`(s), `member`,
   `invitation` live outside the `tenant_isolation` RLS policy, except:
   - `member` and `invitation` **are RLS-scoped by `org_id`** — our
     application-role queries against them (e.g. `authorize()` reading the
     caller's role) see only the scoped tenant's rows.
   - The Better Auth instance connects with the **schema-owner role**
     (`AUTH_DATABASE_URL`), so the plugin manages these tables without RLS
     interference. The two connections are different roles by design
     (ADR-0001 topology).
2. **Organization ids are UUIDv7**, supplied by `beforeCreateOrganization`
   (`{ data: { id: uuidv7() } }`). Time-ordered, offline-sync friendly
   (ADR-0003), and it satisfies the `uuid` column type.
3. **Two separate authorization layers** — neither can leak powers into the
   other:
   - **Org-management** (invite, cancel, change role, delete org): enforced by
     the plugin via `orgAccessControl` + `orgRoles` (`src/server/rbac/org-roles.ts`),
     using the plugin's own statement vocabulary (`member.create`,
     `invitation.cancel`, …).
   - **Business** (products, cash, inventory, reports, …): enforced by
     `authorize()` + the permission matrix (`src/server/rbac/permissions.ts`)
     inside `withTenantDb`.
   A business-matrix bug can never grant "delete the organization", and a
   plugin misconfiguration can never grant "open a cash session".
4. **Roles:** `owner` (everything, incl. delete org), `admin` (everything
   except delete org), `manager`/`stock_manager`/`accountant`/`cashier`/
   `seller` (org-management: none; business: per the matrix). `owner` is the
   `creatorRole`; it cannot be granted via invitation or role change (enforced
   by both our schemas and a last-owner guard on role change).
5. **Branch grants** travel on the invitation as a JSON `branchIds` additional
   field and are materialized into `branch_access` by the
   `afterAcceptInvitation` hook — an unaccepted invitation grants nothing, and
   only branches of the accepting org are honored.
6. **HTTP layer** (`src/server/http.ts` + `src/app/api/**`): route handlers are
   one-liners delegating to services; all error mapping (ApiError,
   AuthorizationError, Better Auth APIError, ZodError) lives in `toHttpError`.
   The browser never supplies an org id — the active org always comes from the
   session, then RLS scopes everything.

## Consequences

- **+** Membership, invitations, role changes are real, tested, and isolated
  (integration suite: signup → verify → onboard → invite → accept → role
  change → last-owner guard → cross-tenant invisibility).
- **+** The org plugin's permission model is a second, independent firewall.
- **−** Two DB connections/roles to configure (`AUTH_DATABASE_URL` = owner,
  `DATABASE_URL` = tenant). Documented in `.env.example` / SECURITY.md.
- **−** `session.activeOrganizationId` couples the identity schema to our
  organizations table (FK). Acceptable: the org plugin defines this field.
- **−** The plugin does **not** send invitation emails; we only ever read the
  invitation row. Invitation delivery is out of scope (the invitee must
  already have an account for the MVP; a real "invite by email with
  sign-up link" flow is a later enhancement and must reuse the verified-email
  gate).

## Verification

- `tests/integration/auth-tenancy.test.ts` — 16 tests on real PostgreSQL:
  UUIDv7 org, owner membership, first branch + access, unverified-email gate,
  invitation → accept → `branch_access` materialized, RBAC matrix (cashier 403
  reports, branch gating, manager cannot invite), role change effective
  without re-login, last-owner guard, canceled-invitation rejection,
  cross-tenant isolation (RBAC + RLS + invitation ledger).
- End-to-end HTTP walk on `next dev` + real PG (see Phase 1b changelog).
