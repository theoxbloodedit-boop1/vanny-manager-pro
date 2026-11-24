# ADR-0010 — TypeScript pinned to 5.9.x

**Status:** ACCEPTED · **Date:** 2026-11-24
**Supersedes:** the TypeScript conclusion in ADR-0008 ("TypeScript 7 is viable and stays").

## Context

ADR-0008 concluded that TypeScript 7.0.2 was viable on the strength of a passing `tsc --noEmit`
and a passing `next build`. That conclusion was **incomplete**, because the verification harness
did not include ESLint.

When the real repository was assembled and linted, the toolchain failed hard:

```
$ eslint .
typescript-eslint does not support TS 7.0.
Please see https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0
See also https://github.com/typescript-eslint/typescript-eslint/issues/10940

Error: typescript-eslint does not support TS 7.0.
```

This is not a warning. `typescript-eslint@8.74.0` refuses to initialise, so **no lint rules run
at all**. `eslint-config-next` depends on it transitively, and pnpm had already flagged the
peer mismatch:

```
✕ unmet peer typescript@">=4.8.4 <6.1.0": found 7.0.2
```

## Decision

**Pin TypeScript to 5.9.3.**

| Option | Verdict |
|---|---|
| Keep TS 7, disable typescript-eslint | Rejected — loses all lint coverage; CI would be decorative |
| Keep TS 7, lint with a separate TS 6 install | Rejected — two compilers in one project, fragile and confusing |
| **Pin TS 5.9.3** | **Accepted** — inside the supported peer range, battle-tested with Next 16 |

## Consequences

- **+** Lint runs and is enforced in CI (`ci-ok` requires it).
- **+** `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` all still apply.
- **+** `skipLibCheck: true` remains mandatory — TS 5.9 also trips on drizzle-orm's optional
  peer `.d.ts` files without it.
- **−** We do not get the TS 7 (Go-native) compiler speed-up. Acceptable: correctness of the
  toolchain beats build speed.
- **−** Two `.d.ts`-level bugs found under TS 7 are irrelevant now, but `skipLibCheck` stays.

## Verification

Executed 2026-11-24 in the repository:

```
$ npx tsc --version
Version 5.9.3

$ npx tsc --noEmit      → exit 0
$ npx eslint .          → exit 0
$ npx vitest run        → 15 passed
$ npx next build --webpack → exit 0
$ node scripts/verify-sw.mjs → OK (41,305 bytes)
```

## Lesson recorded

A dependency is not verified until **every** consumer in the pipeline has been exercised against
it. A passing `tsc` and a passing build said nothing about ESLint. The Phase-0 gate now includes
`pnpm lint` explicitly so this class of gap cannot recur silently.

## Revisit trigger

`typescript-eslint` ships support for TS 7 (tracking issue above). At that point re-run the full
`pnpm verify` and, if green, raise a new ADR to upgrade.
