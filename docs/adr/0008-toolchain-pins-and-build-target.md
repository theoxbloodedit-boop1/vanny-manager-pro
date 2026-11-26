# ADR-0008 — Toolchain pins and the production build target

**Status:** ACCEPTED — **TypeScript section SUPERSEDED by ADR-0010**
**Date:** 2026-11-24 · **Evidence:** `DEPENDENCY-COMPAT.md`

> The Turbopack/Serwist finding below stands unchanged. The TypeScript 7 conclusion does
> **not**: ESLint's `typescript-eslint` does not support TS 7, so TypeScript is pinned to
> 5.9.3. See ADR-0010.

## Context

The stack was specified, not chosen by experiment. This ADR records what was actually executed
on 2026-11-24, and the two findings that changed the plan.

## Verified versions

| Package | Version | Result |
|---|---|---|
| `next` | 16.4.6 | ✅ builds |
| `react` / `react-dom` | 19.3.1 | ✅ |
| `typescript` | ~~7.0.2~~ → **5.9.3** | ✅ | superseded by ADR-0010 |
| `drizzle-orm` | 0.45.4 | ✅ |
| `drizzle-kit` | 0.31.11 | ✅ migration generation verified |
| `better-auth` | 1.7.27 | ✅ org plugin + custom roles |
| `tailwindcss` | 4.3.5 | ✅ v4 `@theme` tokens |
| `zod` | 4.6.7 | ✅ |
| `next-intl` | 4.16.1 | ✅ (runtime untested) |
| `@serwist/next` | 9.5.15 | ⚠️ **webpack only** |
| `@tanstack/react-query` | 5.108.4 | ✅ |
| `dexie` | 4.4.7 | ✅ |
| `@neondatabase/serverless` | 1.2.1 | ✅ compile (DB untested) |

## Finding 1 — Turbopack silently produces no service worker

```
$ rm -f public/sw.js && npx next build --turbopack
✓ Compiled successfully
EXIT 0
RESULT: NO sw.js
```

`@serwist/next` does not support Turbopack. It emits a warning, the build succeeds, and the
PWA ships with **no offline capability at all**. Nobody notices until a cashier loses a sale.

### Decision

**Production builds use `next build --webpack`.** Turbopack is permitted for local dev only,
with `disable: process.env.NODE_ENV !== "production"` on the Serwist plugin so dev is not
misleading.

**Guard:** CI fails if `public/sw.js` is missing or under 10 KB after the build. A build
command change can never silently remove offline again.

## Finding 2 — TypeScript 7 requires `skipLibCheck: true`

Without it, the build fails on **TypeScript's own** `lib.webworker.d.ts` and `lib.dom.d.ts`
(duplicate declarations when both libs are in scope). Not caused by project code.

### Decision

`skipLibCheck: true` — Next's default, now mandatory and documented.

Cross-check: TypeScript 5.9.3 fails the same way on drizzle-orm's own `.d.ts` files (optional
peer deps `gel`, `mysql2`, `bun:sqlite`). This is the normal cost of `skipLibCheck: false`,
which no real Next.js project uses.

~~**TypeScript 7 is therefore viable and stays.**~~ **CORRECTED** — it is not viable, because
`typescript-eslint` does not support TS 7 and refuses to initialise. TypeScript is pinned to
**5.9.3**. See **ADR-0010**.

## Finding 3 — `exactOptionalPropertyTypes` stays on

It caught a genuine defect: Serwist's `precacheEntries` is `undefined` until build-time
injection, so the call site must be `precacheEntries: self.__SW_MANIFEST ?? []`.

## Consequences

- **+** Every version above is proven, not assumed.
- **−** The build command is not the Next.js default. Documented in `README`, `package.json`
  and CI.
- **−** Turbopack remains off for production until `@serwist/turbopack` is stable; revisit
  annually.

## Revisit triggers

- `@serwist/turbopack` reaches stable → re-test, possibly switch back to Turbopack.
- TypeScript 7.1+ fixes the bundled lib duplicates → re-test `skipLibCheck: false`.
