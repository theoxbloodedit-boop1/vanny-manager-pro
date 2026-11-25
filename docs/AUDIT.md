# VANNY MANAGER PRO — Repository Audit

**Audited:** 2026-11-24 (Africa/Johannesburg)
**Repository:** `https://github.com/theoxbloodedit-boop1/vanny-manager-pro`
**Auditor:** Principal Software Architect
**Verdict:** ✅ **CONFIRMED EMPTY — genuine greenfield project.**

---

## 1. First attempt (failed — kept for the record)

At 11:13–11:20 SAST the repository returned `404` on every endpoint and the GitHub
connector was unavailable in the environment. Recorded honestly: the audit was
**blocked**, not completed, at that point. No assumption was made.

| Check | Result at 11:15 |
|---|---|
| `GET /repos/theoxbloodedit-boop1/vanny-manager-pro` | `404 Not Found` |
| `GET /repos/.../branches` | `404` |
| `GET github.com/theoxbloodedit-boop1/vanny-manager-pro` | `404` |
| `GET /users/theoxbloodedit-boop1` | `200` (owner account existed) |

The repository was made public shortly after; the audit was re-run.

---

## 2. Repository identity

| Field | Value |
|---|---|
| Full name | `theoxbloodedit-boop1/vanny-manager-pro` |
| Owner | `theoxbloodedit-boop1` (id `337686382`) |
| Visibility | **public** |
| Fork | No |
| Archived | No |
| Description | `VANNY MANAGER PRO — African multi-business management SaaS.` |
| Created | `2026-11-24T11:04:42Z` |
| Last push | `2026-11-24T11:04:44Z` |
| Size | **0 KB** (GitHub reports 0 — only a 2-line README) |
| Primary language | None |

The repository was created at **11:04:42Z**, nine minutes before this audit began.

---

## 3. Default branch

| Branch | SHA | Protected |
|---|---|---|
| **`main`** ← default | `9424c06f6adc7d784a518786964be117c8d353a3` | **No** |

- `git ls-remote` confirms exactly one ref: `refs/heads/main`.
- `origin/HEAD` → `origin/main`.
- No other branches, no tags, no releases.

> **Action required later:** `main` is unprotected. Before the first real code lands we
> should add branch protection (require PR, require CI green, no force-push) —
> otherwise the "no unverified completion" rule has no mechanical backing.

---

## 4. Complete file inventory

The tree contains **exactly one entry**:

```
README.md   (82 bytes, 2 lines)
```

Contents in full:

```markdown
# vanny-manager-pro
VANNY MANAGER PRO — African multi-business management SaaS.
```

**Absent:** `package.json`, `tsconfig.json`, `next.config.*`, `tailwind.config.*`,
`drizzle.config.ts`, `.env.example`, `.gitignore`, `src/`, `app/`, `public/`,
`.github/workflows/`, `vercel.json`, lockfile, tests, docs.

No source code. No configuration. No CI. No dependencies. No previous history.

---

## 5. Commit history

| | |
|---|---|
| Total commits | **1** |
| SHA | `9424c06f6adc7d784a518786964be117c8d353a3` |
| Message | `Initial commit` |
| Author | `theoxbloodedit-boop1 <theoxbloodedit@gmail.com>` |
| Date | `2026-11-24T11:04:43Z` |
| Parents | **none** (root commit) |
| Files changed | `README.md` (+2 / −0) |

A single root commit with no parents. There is no hidden prior history.

---

## 6. Repository configuration

| Setting | State |
|---|---|
| Branch protection | ❌ none |
| Secret scanning / push protection | not verified — requires admin API scope |
| Dependabot / Renovate | ❌ none |
| GitHub Actions | ❌ no workflows |
| CODEOWNERS | ❌ none |
| Webhooks | unknown — requires admin API scope |
| Topics / homepage / license | none set |

**Not inspected** (needs a token with admin scope): deploy keys, Actions secrets,
webhooks, environment protection rules. None of these block Phase 0; they are
checked before the first deploy.

---

## 7. Local working copy

Cloned to `/home/user/vanny-manager-pro`, clean, on `main`, tracking `origin/main`.
Ready for Phase 0.

---

## 8. Conclusion

| Requirement | Result |
|---|---|
| Identify the default branch | ✅ `main` (`9424c06`) |
| Inspect existing files | ✅ 1 file: `README.md` |
| Inspect repository configuration | ✅ no CI, no protection, no config |
| Confirm this is a new project | ✅ **confirmed empty — 1 commit, 1 file, 0 KB** |

The architecture in `ARCHITECTURE.md` is therefore a **greenfield** plan with no
migration or re-baselining needed. Nothing in the repository constrains the design.

### Recommended first actions on the repo

1. Add `.gitignore` (Node, Next.js, `.env*`, `.next/`).
2. Add `.env.example` — keys only, never values.
3. Add `.github/workflows/ci.yml` (typecheck, lint, test, build).
4. Protect `main`: require PR + green CI + linear history; forbid force-push.
5. Add branch protection *before* the first feature branch, not after.

---

## 9. Current-State Audit — 2026-11-25

**Scope.** Security + integrity audit of the working state at branch
`feat/real-email-delivery` (base `fa2902f`, Phase 1b), triggered before the
production deploy. Covers: gate evidence, the new Resend email transport, a
secret/credential scan (tree + full history), the repo's brief public window,
the dependency tree, and repo/remote state.

**Method.** Executed checks only — no claim is made without a command result.
All gates were re-run fresh for this audit.

### 9.1 Gate evidence (re-run 2026-11-25)

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ exit 0 |
| `eslint .` | ✅ exit 0 |
| `vitest run` | ✅ **73/73** — 6 files (15 prices + 13 permissions + 6 uuid + **12 email (new)** + 13 isolation + 14 auth-tenancy) |
| `next build --webpack` | ✅ exit 0 — 18 routes, service worker bundled |
| `pwa:guard` | ✅ `public/sw.js` present (43,059 bytes) |

### 9.2 Findings

| # | Finding | Severity | Where | Status |
|---|---|---|---|---|
| F-1 | Resend `fetch` had **no timeout** — in serverless a hung call could consume the function's time budget (Better Auth awaits the hook) | Med (robustness) | `src/server/email.ts` | ✅ **Fixed** — 5 s `AbortSignal.timeout`, overridable via `RESEND_TIMEOUT_MS` |
| F-2 | `uuid@13.0.0` was a **dead, vulnerable production dependency** (GHSA-w5hq-g745-h8pq) — imported nowhere; UUIDv7 is hand-rolled in `src/lib/uuid.ts` | Med (supply chain) | `package.json` | ✅ **Fixed** — dependency removed; prod tree now vuln-free |
| F-3 | 5 **dev-only** vulnerabilities (1 critical + 4 moderate): `vitest` (critical = local `vitest --ui` server RCE), `@vitest/mocker` ×2, `esbuild` (via `drizzle-kit`). **None ship to runtime.** | Low (prod) / dev-environment | dev toolchain | ⬜ **Documented** — recommend bumping `vitest` to ≥4.1.12 (clears the critical + 3 moderate) and `drizzle-kit` (pulls newer `esbuild`) |
| F-4 | Repo was **public** from the initial commit until made private on 2026-11-25; Phase 0/1a/1b code was briefly public | Low (residual) | repo history | ✅ **Mitigated** — now private; verified no secrets/tokens in the exposed commits (see 9.3) |
| F-5 | Two GitHub tokens (a fine-grained + a classic `repo`+`workflow`) were pasted in conversation | High (credential hygiene) | out-of-band | ⬜ **Action for owner** — revoke both; issue a fine-grained token with short expiry for future pushes |
| F-6 | `MAIL_TRANSPORT=resend` is now implemented, but `RESEND_API_KEY`/`RESEND_FROM` are **not yet configured** — production cannot deliver email until the owner supplies them | High (launch blocker) | env | ⬜ **Open** — part of deploy (option B) |
| F-7 | RLS catalog introspection test (ROADMAP 1.7b) not yet implemented | Low | `tests/` | ⬜ Open (tracked) |
| F-8 | A literal positive+negative test for *each* of the 33 permissions not yet written (matrix invariants + representative integration tests exist) | Low | `tests/` | ⬜ Open (tracked, Gate 1) |

### 9.3 Secret / credential scan (clean)

- **GitHub token patterns** (`ghp_…`, `github_pat_…`, `x-access-token:…`): **0** matches in the working tree; **0** across every commit in history.
- **Hardcoded `BETTER_AUTH_SECRET`**: none in history (only the documented `openssl rand` generator).
- **`.env.local`**: not present, not tracked. `.env.example` holds keys only.
- **Only credential present** anywhere: `tenant_app_pw` — the dev-only embedded-PostgreSQL role (non-secret by design; appears in `bootstrap-dev-db.mts`, `pg-harness.ts`, README). No production secret is in the tree or history.
- **Public window (F-4):** the commits that were briefly public contain code + the dev-only PG cred only. No production secret, no token, no `.env` values were ever exposed.

### 9.4 Email transport review (`src/server/email.ts`)

- **API key handling:** `RESEND_API_KEY` is sent only in the `Authorization`
  header; **never logged**. Error logs contain the provider detail (status +
  name + message) or the network error object — never the key.
- **XSS:** recipient `name` is HTML-escaped in both email templates (unit-tested
  with an `<img onerror>` payload). `to` is only in the JSON body, never rendered.
- **PII:** recipient address + signed URL are logged only by the `log`/`capture`
  transports (dev/test); the `resend` (prod) transport logs no recipient PII.
- **Failure semantics:** a delivery failure throws; Better Auth's
  `runInBackgroundOrAwait` catches and logs it without failing the sign-up
  response, and the recipient can resend via the built-in
  `/api/auth/send-verification-email`. No fake success, no orphaned account.
- **No new dependency:** delivery uses the runtime `fetch` (serverless-safe);
  `package.json` is unchanged by the email work except the `uuid` removal (F-2).

### 9.5 Repo / remote state

- **Visibility:** private (unauthenticated `GET` → 404).
- **Remote branches:** `main` (9424c06), `phase-0/foundations` (df4afaf),
  `phase-1a/rls-tenant-isolation` (f912a0d), `phase-1b/auth-rbac` (fa2902f).
- **PR #1:** `phase-1b/auth-rbac → main`, open.
- **Working branch:** `feat/real-email-delivery` (email work uncommitted at audit
  time; gates green).

### 9.6 Conclusion

The production **runtime** is in a clean state: gates green, no runtime
vulnerabilities, no secrets in tree or history, and the new email transport is
safe by construction (key never logged, HTML escaped, no PII in prod logs,
bounded timeout). The remaining items are **launch prerequisites** (Resend keys,
Neon — F-6) and **tracked hardening** (F-3 dev-toolchain bump, F-7, F-8), none
of which block the code from being correct. Credential hygiene (F-5) is an
owner action.
