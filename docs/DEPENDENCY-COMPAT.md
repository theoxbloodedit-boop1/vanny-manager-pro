# VANNY MANAGER PRO — Dependency Compatibility Verification

> **Executed:** 2026-11-24 · **Result: PASS with two binding configuration decisions**
> This is a record of what was actually run, not a prediction.

---

## 1. Environment

| Item | Value |
|---|---|
| Node | `v20.20.2` |
| npm | `10.8.2` |
| CPU / RAM | 2 vCPU / 1 GB |
| Install | `npm install` — **150 packages in 56 s, exit 0** |
| Harness | `/home/user/compat-check` (throwaway, outside the repository) |

> The project itself will use **pnpm** with a committed lockfile. npm was used here only
> because pnpm is not installed in this sandbox; package resolution is equivalent for the
> purpose of type/build compatibility.

---

## 2. Test harness

A minimal but non-trivial Next.js app exercising every risky surface:

| File | Exercises |
|---|---|
| `src/db/schema.ts` | `drizzle-orm/pg-core`: `uuid`, `bigint`, `timestamp`, `$inferSelect` |
| `src/db/client.ts` | `drizzle-orm/neon-serverless` + `@neondatabase/serverless` Pool |
| `src/lib/auth.ts` | Better Auth + Drizzle adapter + **organization plugin with custom roles** + `createAccessControl` |
| `src/lib/offline.ts` | Zod 4 schemas, Dexie table, TanStack Query hook, next-intl |
| `src/sw.ts` | Serwist worker with precache manifest |
| `next.config.ts` | `@serwist/next` wrapper |
| `src/app/*` | Next 16 App Router RSC, Tailwind 4 `@theme` tokens |

`tsconfig.json` used **`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`** —
deliberately harsher than typical, to surface real friction.

---

## 3. Results

### 3.1 TypeScript 7.0.2 — ❌ REJECTED (lint toolchain)

The harness typechecked and built successfully, but it **did not include ESLint**. When the
real repository was linted, the toolchain refused to start:

```
$ eslint .
typescript-eslint does not support TS 7.0.
Error: typescript-eslint does not support TS 7.0.
```

`typescript-eslint@8.74.0` fails to initialise, so **no lint rules run at all**. pnpm had
already flagged the peer mismatch on install:

```
✕ unmet peer typescript@">=4.8.4 <6.1.0": found 7.0.2
```

**Decision: TypeScript is pinned to 5.9.3** (ADR-0010). A passing `tsc` and a passing build
said nothing about lint — a dependency is not verified until every consumer has been exercised.

#### What TS 7 did prove

```
$ npx tsc --noEmit --skipLibCheck     # TS 7.0.2
exit 0        ← zero errors in application code
```

Zero errors across Drizzle, Better Auth's organization plugin with custom roles, Zod 4,
next-intl 4, Dexie 4 and TanStack Query 5. The **application code** is TS-7-clean; the
blocker is purely the lint plugin.

#### `skipLibCheck` is mandatory either way

Without it, the build fails on **TypeScript's own bundled lib definitions**:

```
node_modules/@typescript/typescript-linux-x64/lib/lib.webworker.d.ts(522,5):
  error TS2717: Subsequent property declarations must have the same type.
```

And under 5.9.3 the same class of failure appears from drizzle-orm's optional peer `.d.ts`
files (`gel`, `mysql2`, `bun:sqlite`). This is the normal cost of `skipLibCheck: false`,
which no real Next.js project uses. `skipLibCheck: true` stays.

```
$ npx tsc --noEmit --skipLibCheck
exit 0        ← zero errors in application code
```

Zero errors across Drizzle, Better Auth's organization plugin with custom roles, Zod 4,
next-intl 4, Dexie 4 and TanStack Query 5.

**But** without `skipLibCheck`, the build fails — and *not* because of our code:

```
node_modules/@typescript/typescript-linux-x64/lib/lib.webworker.d.ts(522,5):
  error TS2717: Subsequent property declarations must have the same type.
node_modules/@typescript/typescript-linux-x64/lib/lib.dom.d.ts(5894,5):
  error TS2374: Duplicate index signature for type 'number'.
```

These are **TypeScript's own bundled lib definitions**. TS 7.0.2 ships DOM and WebWorker
libs that conflict when both are in scope. `skipLibCheck: true` is the standard Next.js
setting and is now **mandatory**.

> Cross-check: TypeScript 5.9.3 with the same config produced the same class of library
> errors (drizzle-orm's own `.d.ts` files reference optional peer deps like `gel`, `mysql2`,
> `bun:sqlite`). So this is not a TS-7-specific defect — it is the normal cost of
> `skipLibCheck: false`, which no real Next.js project uses.

### 3.2 Next.js 16.4.6 build — ✅ PASS (webpack)

```
$ npx next build --webpack
✓ (serwist) Bundling the service worker script with the URL '/sw.js' and the scope '/'
✓ Compiled successfully in 2.3s
✓ Finished TypeScript in 1019ms
Route (app)
┌ ○ /
└ ○ /_not-found
EXIT 0
```

`public/sw.js` emitted: **40,994 bytes**.

### 3.3 Next.js 16.4.6 build — ⚠️ Turbopack: SILENT FAILURE

```
$ rm -f public/sw.js && npx next build --turbopack
✓ Compiled successfully in 1345ms
✓ Finished TypeScript in 1061ms
EXIT 0

RESULT: NO sw.js — service worker was NOT generated
```

**This is the most important finding of the verification.** The build succeeds, exits 0, and
produces a PWA with **no service worker at all** — no offline capability, silently.

`@serwist/next` only warns:

> *"`@serwist/next` with `next dev --turbopack`, but it doesn't support Turbopack."*

**Binding decision:** production builds run `next build --webpack`. The build script must
assert that `public/sw.js` exists and is non-empty, or fail. This guard goes in CI.

### 3.4 `exactOptionalPropertyTypes` — real defect caught

```
src/sw.ts(15,29): error TS2379: Argument of type '{ precacheEntries:
  (string | PrecacheEntry)[] | undefined; ... }' is not assignable to parameter of
  type 'SerwistOptions' with 'exactOptionalPropertyTypes: true'.
```

Serwist's `__SW_MANIFEST` is `undefined` until build-time injection. Fixed with
`precacheEntries: self.__SW_MANIFEST ?? []`. The flag stays **on** — it caught a genuine bug.

### 3.5 Drizzle Kit 0.31.11 — ✅ PASS

```
$ npx drizzle-kit generate
1 tables
products 7 columns 0 indexes 0 fks
[✓] Your SQL migration file ➜ drizzle/0000_redundant_franklin_storm.sql
```

Generated SQL was correct, including `bigint` minor units and `timestamp with time zone`.

### 3.6 Better Auth organization plugin — ✅ PASS (open question closed)

The Phase-0 spike question was *"does Better Auth support custom org roles?"* Answer: **yes.**

Verified in `node_modules/better-auth/dist/plugins/organization/types.d.mts`:

```ts
export interface OrganizationOptions {
  creatorRole?: string;
  ac?: AccessControl;
  roles?: { [key in string]?: Role<any> };
  ...
}
```

And compiled successfully with `owner` / `manager` / `cashier` defined via
`createAccessControl(...).newRole({...})`, matching the permission matrix in
`ARCHITECTURE.md` §4.2 exactly. **ADR-0002 is confirmed, not assumed.**

### 3.7 Unverified

| Item | Why | Risk |
|---|---|---|
| Neon DB round-trip | no credentials in sandbox | **Phase-0 gate still open** |
| RLS policy behaviour under PgBouncer | no database | verified in Phase 1 with real Postgres |
| `next-intl` runtime routing | harness had no locale provider | verified in Phase 1 |
| Playwright on Android | no device | Phase 5 launch gate |

---

## 4. Final dependency matrix

| Package | Version | Type-check | Build | Notes |
|---|---|:--:|:--:|---|
| `next` | 16.4.6 | ✅ | ✅ | **webpack only for PWA** |
| `react` / `react-dom` | 19.3.1 | ✅ | ✅ | |
| `typescript` | 7.0.2 | ✅ | ✅ | **rejected — `typescript-eslint` does not support TS 7** |
| `typescript` | **5.9.3** | ✅ | ✅ | **chosen** — full `pnpm verify` green |
| `drizzle-orm` | 0.45.4 | ✅ | ✅ | |
| `drizzle-kit` | 0.31.11 | — | — | ✅ generate verified |
| `better-auth` | 1.7.27 | ✅ | ✅ | org plugin + custom roles verified |
| `tailwindcss` | 4.3.5 | ✅ | ✅ | v4 `@theme` tokens |
| `zod` | 4.6.7 | ✅ | ✅ | |
| `next-intl` | 4.16.1 | ✅ | ✅ | runtime untested |
| `@serwist/next` | 9.5.15 | ✅ | ⚠️ | **webpack only; Turbopack = no SW** |
| `serwist` | (transitive) | ✅ | ✅ | |
| `@tanstack/react-query` | 5.108.4 | ✅ | ✅ | |
| `dexie` | 4.4.7 | ✅ | ✅ | |
| `@neondatabase/serverless` | 1.2.1 | ✅ | ✅ | compile only |

---

## 5. Decisions written into the project

1. `skipLibCheck: true` in `tsconfig.json` — mandatory, Next default.
2. `"build": "next build --webpack"` in `package.json` — because of §3.3.
3. CI asserts `public/sw.js` exists and is > 10 KB after build — guards against the silent
   Turbopack failure recurring if the build command is ever changed.
4. `exactOptionalPropertyTypes` stays on.
5. **TypeScript 5.9.3**, not 7 — `typescript-eslint` blocks TS 7 (ADR-0010).
6. `eslint.config.mjs` uses `eslint-config-next/core-web-vitals` + `/typescript`.
7. ADR-0008 records the build findings; ADR-0010 records the TypeScript correction.

---

## 6. How to reproduce

```bash
# in the repository
pnpm install
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint .
pnpm test           # vitest run
pnpm build          # next build --webpack
pnpm pwa:guard      # service-worker present and non-stub
pnpm db:generate    # drizzle-kit generate
```

Executed 2026-11-24 — all exit 0. `tsc --version` → **5.9.3**.

The harness is intentionally throwaway. Phase 0 recreates the same checks as **CI jobs**, not
as a one-off local run.
