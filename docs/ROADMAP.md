# VANNY MANAGER PRO — Implementation Roadmap (v1)

> Status: **PROPOSED — CTO-approved architecture with conditions.**
> **Authorized scope: PHASE 0 ONLY.** No business module work is authorized yet.
> Companion to `ARCHITECTURE.md`, `SECTORS.md`, `DEPENDENCY-COMPAT.md`.

---

## How to read this

- **Duration** = focused engineering time for one senior full-stack engineer, excluding review
  wait. Treat as ±40%.
- **Gate** = hard acceptance criteria. Nothing is declared done without them.
- **A phase does not start until the previous gate passes.**
- **Deliberately absent:** any demo dashboard. The first screen with real data appears in Phase 3.

---

## Phase 0 — Foundations and verification · **AUTHORIZED**

Purpose: prove the toolchain before writing business code, close the audit, and open the
pipeline.

| # | Task | Output | Status |
|---|---|---|---|
| 0.1 | Repository audit | `AUDIT.md` | ✅ **DONE** — `main`, 1 file, empty, greenfield |
| 0.2 | Architecture + roadmap + ADRs | `docs/` | ✅ **DONE** |
| 0.3 | Dependency compatibility | `DEPENDENCY-COMPAT.md` | ✅ **DONE** — see below |
| 0.4 | Branch protection plan | `GITHUB-SECURITY.md` | ⛔ **BLOCKED** — needs admin scope |
| 0.5 | Neon provisioning guide | `NEON-SETUP.md` | ✅ **DONE** (instructions; not executed) |
| 0.6 | CI workflow design | `CI-DESIGN.md` | ✅ **DONE** (design; not applied) |
| 0.7 | Make repo private | — | ⛔ **BLOCKED** — needs admin scope |
| 0.8 | Restore Arena access post-private | — | ⛔ **BLOCKED** — needs a token |
| 0.9 | Scaffold Next 16 + TS 5.9.3 + Tailwind 4 + ESLint | `pnpm verify` green | ✅ **DONE** |
| 0.10 | Neon project + roles + RLS + extensions | DB round-trip | ⛔ **BLOCKED — owner must provision Neon** |
| 0.11 | Better Auth spike on a **running** server | login + org + invite proven | ⬜ needs Better Auth wiring (Phase 1) |
| 0.12 | CI green on a PR | `ci-ok` required check | ⛔ **BLOCKED — no push credentials** |
| 0.13 | Real-DB integration suite (RLS, FKs, cash invariant) | `tests/integration/` green | ✅ **DONE** — 11/11 on real PostgreSQL (ADR-0011) |

### Phase 0 evidence already produced (2026-11-24)

| Check | Result |
|---|---|
| `next build --webpack` | ✅ **EXIT 0** — compiled, type-checked, pages generated |
| `next build --turbopack` | ⚠️ **EXIT 0 but NO service worker** — silent failure |
| `tsc --noEmit` (TS **5.9.3**) | ✅ exit 0 — TS 7 rejected by `typescript-eslint` (ADR-0010) |
| `eslint .` | ✅ exit 0 |
| `vitest run` (unit + integration) | ✅ **26/26 passing** — 15 unit + 11 on real PostgreSQL |
| `drizzle-kit generate` | ✅ 7 tables, 12 FKs, 7 RLS policies |
| Real-DB migration apply | ✅ fresh server, correct order (fixed FK-before-index bug) |
| `pnpm pwa:guard` | ✅ `sw.js` 41,305 bytes |
| `drizzle-kit generate` | ✅ correct migration emitted |
| Better Auth org plugin + custom roles | ✅ **compiles** — open question closed |
| 150 packages installed | ✅ 56 s, exit 0 |

### Gate 0

- [x] Repository audit complete and archived.
- [x] Dependency compatibility verified with executed evidence.
- [x] Better Auth organization + custom roles confirmed supported (compile-level).
- [ ] `pnpm build` passes in the real repository.
- [ ] A real DB query round-trips from a serverless context.
- [ ] Better Auth: register → login → create org → invite member, **on a running server**.
- [ ] CI blocks a red build; `ci-ok` is a required check.
- [ ] `public/sw.js` guard passes.
- [ ] **Repository private + access restored** (prerequisite for 0.9).

> Two items in this gate cannot be closed from the sandbox: the DB round-trip (no credentials)
> and the visibility change (no admin scope). Both are reported as blockers, not assumed.

---

## Phase 1 — Tenancy, auth, RBAC, organizations, branches

**Authorized** by the CTO master brief (2026-11-24) — building now.

| # | Task | Status |
|---|---|---|
| 1.1 | `withTenantDb()` + `SET LOCAL app.org_id` + RLS on all tenant tables | ✅ **DONE** — `src/db/tenant.ts`, policies in `schema/rls.ts`, tested on real PG (ADR-0001/0011) |
| 1.7 | **T4 tenant isolation suite** (real-DB) | ✅ **DONE** — `tests/integration/isolation.test.ts`, 11/11. RLS catalog verification still open (see 1.7b) |
| 1.7b | RLS catalog introspection CI test (`pg_policies`) | ⬜ open |
| 1.2 | Permission matrix + `authorize()` | ⬜ next |
| 1.3 | Organization CRUD, **sector** + dual-currency settings + timezone onboarding | ⬜ open |
| 1.4 | Branch CRUD + `member_branch_access` | ⬜ open |
| 1.5 | Staff invitations, role and branch assignment | ⬜ open |
| 1.6 | Org switcher (multiple orgs per owner) | ⬜ open |
| 1.8 | Audit log wiring | ⬜ open |

**Gate 1**
- [ ] Org A cannot read/write/delete Org B through **any** path — automated.
- [ ] Direct SQL with `app.org_id` unset returns 0 rows on every tenant table.
- [ ] A cashier reaching an unassigned branch gets 403, not an empty list.
- [ ] Role changes apply on the next request without re-login.
- [ ] Every permission has ≥1 positive and ≥1 negative test.
- [ ] RLS catalog check passes: no tenant table is unprotected.

---

## Phase 2 — Catalog and inventory

**Not yet authorized.**

| # | Task |
|---|---|
| 2.1 | Categories, products (goods + services), units, SKU, barcode |
| 2.2 | **Independent USD and CDF prices** — both mandatory, neither derived |
| 2.3 | Per-branch stock derived from movements |
| 2.4 | Movements: purchase, adjustment, transfer in/out, sale, return |
| 2.5 | Atomic branch-to-branch transfers |
| 2.6 | Low-stock thresholds |
| 2.7 | Search (`pg_trgm` + `unaccent`) |

**Gate 2**
- [ ] `branch_stock == Σ movements` invariant holds after every mutation type (**T3**).
- [ ] A transfer moves stock in both branches or neither.
- [ ] A sale with insufficient stock fails **unless** the item is a service or untracked — explicit.
- [ ] A product with a missing price in either currency is rejected at write time.
- [ ] Accent/case-insensitive search under 150 ms on 10k products.

---

## Phase 3 — Sales, payments, dual currency, cash sessions

**Not yet authorized.** This is the core of the product and gets the most scrutiny.

| # | Task |
|---|---|
| 3.1 | POS: keypad-first, barcode, search, cart |
| 3.2 | Price-list currency selection (USD / CDF) per sale |
| 3.3 | Mixed USD/CDF tender, change in either currency |
| 3.4 | FX rate management + history + **sale-time snapshot** |
| 3.5 | Sale lifecycle: completed → voided / refunded (reversing documents) |
| 3.6 | **Per-currency cash sessions** — open, close, counted variance |
| 3.7 | Receipt rendering (server-rendered) |
| 3.8 | Sales list, detail, daily summary |

**Gate 3**
- [ ] **T1 mixed-currency payments** — every tender×change combination reconciles exactly.
- [ ] Change is correct in every combination, in both currencies.
- [ ] A completed sale is immutable; voiding creates a reversing document.
- [ ] Cash close reconciles per currency: float + takings − refunds − counted = variance.
- [ ] **T7** — changing the FX rate never alters a historical sale.
- [ ] A cashier cannot void their own sale.
- [ ] A product priced only in one currency cannot be silently converted.

---

## Phase 4 — Customers, expenses, reporting

**Not yet authorized.**

| # | Task |
|---|---|
| 4.1 | Customers: create, phone search, balance tracking |
| 4.2 | Balance updates from sales and payments |
| 4.3 | Expense categories + entry + receipt attachment |
| 4.4 | Expense approval (manager/owner) |
| 4.5 | Reports: sales by day/branch/cashier, payment split, expenses, stock value, variances |
| 4.6 | **Currency-specific reports** + consolidated with explicit conversion |
| 4.7 | CSV export |

**Gate 4**
- [ ] Every number traces to a real `SELECT`. An empty org shows empty states, not fake zeros.
- [ ] Reports are scoped to the caller's branches.
- [ ] CDF and USD are never summed without an explicit rate row.
- [ ] CSV matches the screen exactly (automated comparison).

---

## Phase 5 — PWA and offline · **LAUNCH REQUIREMENT**

**Not yet authorized.** Full offline POS is a **mandatory commercial launch requirement**
(CTO Decision 1) — not a stretch goal.

| # | Task |
|---|---|
| 5.1 | Serwist service worker — **webpack build only** |
| 5.2 | Manifest, maskable icons, install prompt |
| 5.3 | Dexie schema mirroring server tables |
| 5.4 | Outbox: UUIDv7 ops, statuses, exponential backoff |
| 5.5 | `/api/sync/push` with `operation_id` idempotency |
| 5.6 | `/api/sync/pull` delta sync, branch-scoped |
| 5.7 | Per-entity conflict resolvers |
| 5.8 | Device registry + revocation flow |
| 5.9 | Offline UI: banner, pending count, retry, "requires connection" screens |
| 5.10 | **Real-device acceptance test §6.7** — recorded |

**Gate 5 — launch-blocking**

- [ ] A sale created fully offline appears **exactly once** on the server.
- [ ] Retrying the same op 5× creates 1 sale (**T8**).
- [ ] **T2 simultaneous offline sales** — two devices, same product, no duplicate, correct stock.
- [ ] Offline customer with an existing phone merges, never duplicates.
- [ ] A cashier's device never receives another branch's stock.
- [ ] Queue survives reload and browser restart.
- [ ] **T5 device revocation** — 401, local wipe, no further sync.
- [ ] Storage quota and eviction handled with a visible warning.
- [ ] **§6.7 real-device run passes on 1 low-end + 1 mid-range Android device, recorded.**

> If Gate 5 is not met, offline is announced as beta. It is never announced as working.

---

## Phase 6 — Sector extensions, i18n, hardening

**Not yet authorized.** Sector extensions are prioritised by pilot demand, not all at once.

| # | Task |
|---|---|
| 6.1 | Sector readiness review against `SECTORS.md` §7 |
| 6.2 | Platform admin surface + audited cross-tenant access |
| 6.3 | Support-access grants (time-boxed, owner-approved) |
| 6.4 | French string audit; `en`/`sw` message files type-checked |
| 6.5 | Security headers, CSP, rate limiting, gitleaks |
| 6.6 | Error tracking, uptime, **T6 restore drill** |
| 6.7 | 3G performance pass |
| 6.8 | Accessibility pass |
| 6.9 | Sector extensions in pilot order (e.g. salon appointments, boutique variants) |

**Gate 6**
- [ ] **T6** — PITR restore drill matches row counts and totals; timed and documented.
- [ ] No secret in the built client bundle (automated scan).
- [ ] Core POS flow usable on a low-end Android over throttled 3G (< 3 s interactive).
- [ ] French UI reviewed by a native speaker; no untranslated keys.
- [ ] Platform admin cannot read tenant data without an audit entry.
- [ ] Each sector's claims match `SECTORS.md` §7 exactly.

---

## Phase 7 — Pilot (not a code phase)

- 1–3 real businesses, at least one boutique and one bar.
- Daily observation of cash closes and stock counts.
- Defect triage; **no new features during pilot.**
- Exit: 2 consecutive weeks with zero data-integrity defects and a completed cash close every day.

---

## Timeline summary

| Phase | Duration | Cumulative |
|---|---|---|
| 0 — Foundations | 3–5 d | week 1 |
| 1 — Tenancy & RBAC | 1.5–2 wk | week 3 |
| 2 — Catalog & inventory | 1.5–2 wk | week 5 |
| 3 — Sales & cash | 2–3 wk | week 8 |
| 4 — Customers, expenses, reports | 1.5–2 wk | week 10 |
| 5 — PWA & offline (**launch requirement**) | 3–4 wk | week 14 |
| 6 — Sectors, i18n, hardening | 2–3 wk | week 17 |
| Pilot | 2–4 wk | week 21 |

**~17 weeks to a launchable v1**, usable internally from week 8. Phase 5 cannot be cut — it is
a commercial requirement, and cutting it removes the launch gate rather than the work.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Offline sync corrupts stock** | Medium | Critical | Append-only movements, server recomputation, T2/T3/T8, visible negative stock |
| **Cross-tenant leak** | Low | Critical | 3-layer isolation, T4 merge blocker, RLS catalog check |
| **Silent PWA failure (no SW)** | **Found** | High | `next build --webpack` + `sw.js` CI guard (ADR-0008) |
| **Dual-price drift** | High | Medium | Both prices mandatory, price audit fields, missing-price filter |
| **FX snapshot lost** | Medium | High | Snapshot on every document, T7 regression test |
| **Better Auth limits** | Low | Medium | Spike already passed at compile level; runtime check in Phase 0 |
| **Neon latency from DRC** | Medium | Medium | Region measured in Phase 0 before Phase 1 |
| **Repo goes private, access lost** | Medium | High | Token issued **before** the switch; sequence in `GITHUB-SECURITY.md` |
| **Sector over-claim** | High | High | `SECTORS.md` §7 readiness matrix is binding |
| **Scope creep into deferred modules** | High | High | §1.2 out-of-scope list is binding |
| **Low-end Android performance** | Medium | High | 3G budget in Phase 6; 3-tap sale criterion |

---

## What "done" means

1. Every number on screen is computed from stored rows.
2. Every button does what it says, or it is not rendered.
3. A cashier in Fungurume can sell offline, take mixed currency, close two registers, and see
   the same figures as the owner.
4. An owner cannot see another owner's data — and a test proves it.
5. No sector is advertised beyond what it actually does.
6. Nothing is deployed until you approve it.
