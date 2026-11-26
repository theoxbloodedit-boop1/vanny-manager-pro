# VANNY MANAGER PRO — CI Workflow Design

> Status: **design — not yet applied.** Applies once the repo is private and access is restored.

---

## 1. Principles

1. **CI is the enforcement layer.** If a rule is not a check, it is a suggestion.
2. **Fast feedback first.** Typecheck and lint run before the expensive build.
3. **Every job runs against a real database** where it matters. No mocked RLS.
4. **Fail closed.** A missing artifact (e.g. `sw.js`) fails the build.

---

## 2. Workflow: `ci.yml` — on every PR and push to `main`

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  NEXT_TELEMETRY_DISABLED: 1

jobs:
  # ---------- 1. Static gates ----------
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  secrets-guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: No secret-looking values in .env.example
        run: |
          if grep -E '^[A-Z_]+=.+' .env.example; then
            echo "::error::.env.example must contain keys only"; exit 1; fi
      - name: No secret-bearing NEXT_PUBLIC_ vars
        run: |
          if grep -rE 'NEXT_PUBLIC_[A-Z_]*(SECRET|KEY|TOKEN|PASSWORD)' --include='*.ts' --include='*.tsx' --include='*.env*' .; then
            echo "::error::secret-bearing NEXT_PUBLIC_ variable"; exit 1; fi
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  # ---------- 2. Unit ----------
  test-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:unit -- --coverage
      - uses: actions/upload-artifact@v4
        with: { name: unit-coverage, path: coverage/ }

  # ---------- 3. Integration (real Postgres, RLS on) ----------
  test-integration:
    runs-on: ubuntu-latest
    needs: [typecheck]
    services:
      postgres:
        image: postgres:17
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: vanny_test }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 5s --health-retries 10
    # Throwaway credentials for the ephemeral GitHub Actions service container.
    # Not a secret — the container is destroyed when the job ends.
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/vanny_test
      DIRECT_URL: postgres://postgres:postgres@localhost:5432/vanny_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:migrate
      - run: pnpm test:integration
      # T4 is a merge blocker on its own
      - name: Tenant isolation (T4) must be green
        run: pnpm test:integration -- --grep "tenant isolation"

  # ---------- 4. Build ----------
  build:
    runs-on: ubuntu-latest
    needs: [typecheck, lint]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      # --webpack is MANDATORY: Turbopack silently emits no service worker
      - run: pnpm build
      - name: PWA service worker guard
        run: |
          if [ ! -f public/sw.js ] || [ "$(wc -c < public/sw.js)" -lt 10000 ]; then
            echo "::error::public/sw.js missing or empty — PWA would have no offline capability"; exit 1; fi
      - uses: actions/upload-artifact@v4
        with: { name: build-output, path: .next/ }

  # ---------- 5. E2E ----------
  test-e2e:
    runs-on: ubuntu-latest
    needs: [build]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: playwright-report, path: playwright-report/ }

  # ---------- 6. Gate ----------
  ci-ok:
    runs-on: ubuntu-latest
    needs: [typecheck, lint, secrets-guard, test-unit, test-integration, build, test-e2e]
    if: always()
    steps:
      - name: Fail if any job failed
        if: contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')
        run: exit 1
```

**`ci-ok` is the required status check.** One name to protect, and it aggregates everything.

---

## 3. Workflow: `preview-db.yml` — Neon branch per PR

```yaml
name: Preview DB
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  preview-db:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Create Neon branch for this PR
        run: |
          npx -y @neondatabase/cli@latest branches create \
            --project-id "$NEON_PROJECT_ID" \
            --name "preview/pr-${{ github.event.pull_request.number }}" \
            --api-key "$NEON_API_KEY"
      - name: Output pooled connection string
        id: conn
        run: |
          echo "url=$(npx -y @neondatabase/cli@latest connection-string \
            --project-id "$NEON_PROJECT_ID" \
            --branch-name "preview/pr-${{ github.event.pull_request.number }}" \
            --pooled --api-key "$NEON_API_KEY")" >> "$GITHUB_OUTPUT"
    outputs:
      database_url: ${{ steps.conn.outputs.url }}

  destroy:
    if: github.event.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - name: Delete Neon branch
        run: |
          npx -y @neondatabase/cli@latest branches delete \
            --project-id "$NEON_PROJECT_ID" \
            --branch "preview/pr-${{ github.event.pull_request.number }}" \
            --api-key "$NEON_API_KEY"
```

**Do not enable this until Phase 1.** It costs money per branch-hour and is only needed once
there is a schema worth migrating.

---

## 4. Workflow: `release.yml` — disabled

Created but with `if: false` and a manual `workflow_dispatch`. **Nothing deploys to
production until explicit CTO approval.** See `ROADMAP.md` Phase 6.

---

## 5. Required status checks on `main`

| Check | Blocks merge | Why |
|---|:--:|---|
| `ci-ok` | ✅ | Aggregate of all jobs |
| `pwa-sw-guard` | ✅ | Prevents shipping a PWA with no service worker |
| `secrets-guard` | ✅ | Prevents credential leaks |
| `test-integration` | ✅ | Contains T4 tenant isolation |

Branch protection config that references these is in `GITHUB-SECURITY.md` §4.

---

## 6. Runtime budget

| Job | Target |
|---|---|
| typecheck | < 90 s |
| lint | < 60 s |
| secrets-guard | < 30 s |
| test-unit | < 60 s |
| test-integration | < 120 s |
| build | < 180 s |
| test-e2e | < 240 s |
| **total wall clock** | **< 6 min** (jobs run in parallel where possible) |

If CI exceeds 8 minutes, developers start bypassing it. Treat this as a hard budget.

---

## 7. What is deliberately absent

- **No deploy step.** Not yet.
- **No nightly performance tests.** Phase 6.
- **No dependency auto-merge.** Renovate opens PRs; a human merges.
- **No Slack notifications.** Add when there is a team to notify.
