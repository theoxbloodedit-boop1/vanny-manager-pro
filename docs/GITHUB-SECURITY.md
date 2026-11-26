# VANNY MANAGER PRO — GitHub Security Plan

> **Status:** prepared and partially executed. See §8 for what is done and what is blocked.
> **CTO Decision 4 (final):** least-privilege access; the owner configures branch protection
> manually. `Administration: Write` is **not** requested.

---

## 1. Current state (audited 2026-11-24)

| Setting | State |
|---|---|
| Visibility | **public** — change pending |
| Default branch | `main` |
| Branch protection | none — owner will configure |
| Commit history | 1 commit, 1 file (`README.md`) |
| CI / workflows | none yet — added in this PR |
| Secret scanning | unknown (needs admin scope) |

Nothing confidential has been committed. That is exactly why the visibility change belongs
**now**, before any code, not after.

---

## 2. Before changing visibility — the pre-flight sequence

Changing visibility is the step most likely to strand the work. Do it in this order.

### Step 1 — Verify authenticated GitHub access (still public)

```bash
# must succeed with a 200 before proceeding
curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/theoxbloodedit-boop1/vanny-manager-pro \
  | jq -r '.full_name, .permissions'
```

Expected: `full_name` and `permissions.push: true`.

### Step 2 — Verify `git fetch` works with that credential

```bash
cd vanny-manager-pro
git fetch origin --prune      # must succeed
git status --short --branch   # must show a clean, up-to-date branch
```

### Step 3 — Verify local work is preserved

```bash
git log --oneline -5           # your commits are present
git stash list                 # should be empty
git status --porcelain         # should be empty before switching anything
```

If anything is uncommitted, commit it first. A visibility change does not touch local files,
but a failed push afterwards is easy to misread as data loss.

### Step 4 — Change visibility

UI: `Settings` → `Danger Zone` → **Change repository visibility** → **Make private**.

API (needs `Administration: write`, which we are deliberately not requesting):

```bash
curl -X PATCH -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/theoxbloodedit-boop1/vanny-manager-pro \
  -d '{"private": true}'
```

### Step 5 — Confirm access after the change

```bash
# anonymous must now be denied
curl -sS -o /dev/null -w "%{http_code}\n" \
  https://api.github.com/repos/theoxbloodedit-boop1/vanny-manager-pro
# expected: 404

# authenticated must still work
curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" -o /dev/null -w "%{http_code}\n" \
  https://api.github.com/repos/theoxbloodedit-boop1/vanny-manager-pro
# expected: 200

git fetch origin   # must succeed
```

**Do not skip step 5.** A `404` for anonymous and `200` for authenticated is the only proof
the change did what was intended.

---

## 3. Token — least privilege

Create at `https://github.com/settings/personal-access-tokens/new`.

| Field | Value |
|---|---|
| Token name | `vanny-manager-pro-arena` |
| Expiration | 90 days, calendar reminder to rotate |
| Resource owner | `theoxbloodedit-boop1` |
| Repository access | **Only select repositories** → `vanny-manager-pro` |

| Permission | Access | Justification |
|---|---|---|
| **Contents** | **Read and write** | commit, branch, push |
| **Pull requests** | **Read and write** | open the PR, read checks |
| **Metadata** | **Read** | default; required for the API to resolve the repo |

**Explicitly NOT requested:**

| Permission | Why not |
|---|---|
| `Administration: write` | Would allow changing visibility and branch protection. Not needed for development, and the owner is configuring protection manually. |
| `Secrets` | No secrets are stored in GitHub by the agent. |
| `Actions` | CI is defined in the repo; no runtime control needed. |
| `Issues`, `Discussions`, `Workflows` | Out of scope. |

### Storing the token

**Never paste it into chat.** Put it in a secret store and reference it by name, or configure
a credential helper inside the sandbox:

```bash
git config --global credential.helper store
printf 'https://%s:x-oauth-basic@github.com\n' "$TOKEN" > ~/.git-credentials
chmod 600 ~/.git-credentials
```

`~/.git-credentials` is outside the workspace snapshot and is never committed.

### Consequence of least privilege

Because the token lacks `Administration: write`, **the agent cannot apply branch protection
and cannot change visibility.** That is intended. Those two steps belong to the owner, and
this document gives them the exact rule set to paste.

---

## 4. Branch protection — applied manually by the owner

`Settings` → `Branches` → `Add branch protection rule` → branch name pattern: `main`.

| Rule | Value | Why |
|---|---|---|
| Require a pull request before merging | ✅ | No direct pushes |
| Required approvals | **1** | Second pair of eyes |
| Dismiss stale pull request approvals when new commits are pushed | ✅ | Approval must match the code |
| Require review from Code Owners | ✅ | `CODEOWNERS` covers schema, money, CI |
| Require status checks to pass before merging | ✅ | |
| Status checks found | `ci-ok` | Single aggregate check |
| Require branches to be up to date before merging | ✅ | Catches integration drift |
| Require conversation resolution before merging | ✅ | No unresolved review threads |
| Require signed commits | ⬜ optional | Recommended after Phase 1 |
| **Require linear history** | ✅ | Squash merge only |
| **Do not allow bypassing the above settings** (enforce admins) | ✅ | Applies to the owner too |
| Allow force pushes | ❌ | History is immutable |
| Allow deletions | ❌ | |
| Merge strategy | **Squash** — disable merge commits and rebase merging | One feature = one commit |

### The one check that must exist: `ci-ok`

Defined in `.github/workflows/ci.yml`. It aggregates `typecheck`, `lint`, `secrets-guard`,
`test-unit` and `build`. The build job itself runs `pnpm pwa:guard`, which fails if the
service worker is missing — the guard against the silent Turbopack failure in ADR-0008.

If `ci-ok` is not in the required checks list, the pipeline is decorative.

---

## 5. Secret handling rules (binding, enforced in CI)

| Rule | Enforcement |
|---|---|
| No `.env` in git | `.gitignore` covers `.env`, `.env.*`, `!.env.example` |
| `.env.example` holds keys only | CI `secrets-guard` fails on any non-empty value |
| No secret in the client bundle | CI regex scan for secret-bearing `NEXT_PUBLIC_*` |
| History scanning | `gitleaks` on every push and PR |
| Dependency scanning | `pnpm audit` (Phase 1) |
| Token rotation | 90-day expiry, calendar reminder |

CI also runs a repository-wide scan for `NEXT_PUBLIC_[A-Z0-9_]*(SECRET|KEY|TOKEN|PASSWORD)`.

---

## 6. Execution order

```
1. [you] Issue the least-privilege token (§3)
2. [me]  Verify authenticated read + git fetch            ← pre-flight §2 steps 1–3
3. [you] Make the repository private                       ← §2 step 4
4. [me]  Confirm access after the change                   ← §2 step 5
5. [me]  Push phase-0/foundations, open the PR
6. [me]  Confirm `ci-ok` is green on the PR
7. [you] Apply branch protection (§4) — includes requiring `ci-ok`
8. [you] Merge the PR
```

Step 7 can happen at any point after the PR exists; it does not block steps 5–6.

---

## 7. What is done vs blocked

| Item | Status |
|---|---|
| Least-privilege token specification | ✅ documented (§3) |
| Pre-flight verification sequence | ✅ documented (§2) |
| Branch-protection rule set | ✅ documented (§4) |
| `CODEOWNERS` | ✅ committed |
| `secrets-guard` CI job | ✅ committed |
| `.gitignore` / `.env.example` | ✅ committed |
| Actual visibility change | ⛔ **owner action** — needs `Administration: write` |
| Actual branch protection | ⛔ **owner action** — by design |
| Authenticated push / PR | ⛔ **blocked until a token exists** |

---

## 8. What I need from the owner

1. **A fine-grained PAT** with exactly Contents RW, Pull requests RW, Metadata R — placed in a
   secret store or the sandbox credential helper, **not in chat**.
2. **Confirmation** once the repository is private, so I can re-run the §2 step 5 verification.
3. Nothing else. Branch protection is theirs to apply, and the rule set is above.
