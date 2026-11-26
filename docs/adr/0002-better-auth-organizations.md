# ADR-0002 — Better Auth with the organization plugin for tenancy membership

**Status:** ACCEPTED · **Date:** 2026-11-24 · **Verified:** 2026-11-24 (compile spike)

## Context

The product requires multiple organizations per owner, role-based access (owner, manager,
cashier), and invitations. Building this by hand costs weeks and is easy to get subtly wrong.

## Decision

Use **Better Auth 1.7.x** with:

- the **Drizzle adapter** against the same Neon database,
- the **organization plugin** as the membership substrate (`organization`, `member`,
  `invitation` tables),
- **custom roles** declared through `createAccessControl` + `ac.newRole(...)`,
- `creatorRole: "owner"`.

Platform admin is **not** an organization role. It lives in `platform_admins`, a separate
table, and never receives tenant-wide powers by implication.

## Verification performed

The open question was whether Better Auth's organization plugin accepts arbitrary role
definitions. Confirmed in the installed package:

```ts
// node_modules/better-auth/dist/plugins/organization/types.d.mts
export interface OrganizationOptions {
  creatorRole?: string;
  ac?: AccessControl;
  roles?: { [key in string]?: Role<any> };
}
```

A configuration defining `owner`, `manager` and `cashier` with the exact permission matrix in
`ARCHITECTURE.md` §4.2 compiled cleanly under TypeScript strict mode (verified again on the
pinned 5.9.3 in the repository — see ADR-0010).
See `DEPENDENCY-COMPAT.md` §3.6.

## Consequences

- **+** Identity, sessions, invitations, org membership and role storage are not hand-rolled.
- **+** Role→permission mapping is data (`ac.newRole`), so adding a permission does not
  require touching call sites.
- **−** Better Auth owns its table shapes. Custom columns are added via its schema
  extension mechanism, not by editing migrations by hand.
- **−** Upgrades may migrate auth tables. Migrations are reviewed in PRs like any other.
- **−** The permission matrix in `ARCHITECTURE.md` §4.2 is the source of truth; the
  `ac.newRole` definitions must be kept in lockstep. A unit test asserts the two agree.

## Fallback (not needed)

Had custom roles been unsupported, the plan was to keep Better Auth for identity only and own
`memberships`/`roles` ourselves. Contained change; recorded for completeness.

## Binding rules

1. `authorize(orgId, permission)` is the only authorization entry point. No `role === "owner"`
   comparisons in feature code.
2. UI hiding is cosmetic. Server enforcement is the law.
3. Platform admin access is audited and time-boxed. No silent impersonation in v1.
