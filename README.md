# VANNY MANAGER PRO

African multi-business management SaaS — boutiques, bars, restaurants, hair salons and pharmacies.

> **Status: Phase 1a — tenancy foundation.** The multi-tenant schema is live with
> row-level security, proven by a 13-test suite on a real PostgreSQL server
> (`tests/integration/`, ADR-0011). Authentication and RBAC are not built yet, and
> there is no dashboard — deliberately no demo data. See `docs/ROADMAP.md`.

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind CSS v4 · shadcn/ui ·
Neon PostgreSQL · Drizzle ORM · Better Auth · Zod · TanStack Query · PWA (Serwist)

## Requirements

- Node.js >= 20.9 (CI runs 22)
- pnpm 10
- A Neon PostgreSQL project (see `docs/NEON-SETUP.md`)

## Setup

```bash
pnpm install
cp .env.example .env.local     # fill in DATABASE_URL / DIRECT_URL / BETTER_AUTH_SECRET
pnpm db:generate               # generate a migration from the schema
pnpm db:migrate                # apply it (requires DIRECT_URL)
pnpm dev
```

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Local dev server |
| `pnpm build` | **Production build — `next build --webpack`** |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | All Vitest suites (unit + integration) |
| `pnpm test:unit` | Unit tests only (money, prices) |
| `pnpm test:integration` | **Real-PostgreSQL** suite: RLS, FKs, cash invariant (embedded-postgres, no secrets) |
| `pnpm db:generate` | Generate SQL migration from `src/db/schema` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm pwa:guard` | Fail if the service worker is missing or a stub |
| `pnpm verify` | Everything above, in order |

### ⚠️ Build target

Production builds **must** use `next build --webpack`. Turbopack exits 0 while
emitting **no service worker**, which silently removes all offline capability.
`pnpm pwa:guard` exists to make that failure loud. See `docs/adr/0008-toolchain-pins-and-build-target.md`.

## Documentation

| Document | Content |
|---|---|
| `docs/ARCHITECTURE.md` | System architecture, tenancy, data model, offline design |
| `docs/ROADMAP.md` | Phased plan with hard acceptance gates |
| `docs/SECTORS.md` | Per-sector domain specs and readiness matrix |
| `docs/AUDIT.md` | Repository audit evidence |
| `docs/DEPENDENCY-COMPAT.md` | Executed dependency verification |
| `docs/GITHUB-SECURITY.md` | Access model and branch protection rules |
| `docs/NEON-SETUP.md` | Database provisioning, RLS, restore drill |
| `docs/CI-DESIGN.md` | CI pipeline design |
| `docs/adr/` | Architecture decision records |

## Rules

1. **No fake functionality.** A button either works or is not rendered.
2. **No fake analytics.** Every number comes from a stored row.
3. **No secrets in git.** `.env*` is ignored except `.env.example`, which holds keys only.
4. **No direct pushes to `main`.** Feature branch + PR + green `ci-ok`.
5. **No cross-tenant access.** Enforced by three layers and a merge-blocking test.
6. **No unverified claims.** A feature is done when its acceptance criteria pass.
