# VANNY MANAGER PRO — Technical Architecture (v1 proposal)

> Status: **PROPOSED — awaiting review. Nothing has been implemented.**
> Prepared: 2026-11-24 · Author: Principal Software Architect
> Repository: `theoxbloodedit-boop1/vanny-manager-pro`

---

## 0. Repository audit — status: **COMPLETE ✅**

Full evidence in [`AUDIT.md`](./AUDIT.md). Summary:

| Item | Finding |
|---|---|
| Repository | `theoxbloodedit-boop1/vanny-manager-pro` — **public**, not a fork, not archived |
| Default branch | **`main`** @ `9424c06f6adc7d784a518786964be117c8d353a3` |
| File inventory | **`README.md` only** (82 bytes, 2 lines) |
| Commit history | **1 commit**, root (`Initial commit`), no parents |
| Size | **0 KB** |
| Created | `2026-11-24T11:04:42Z` — nine minutes before this audit |
| CI / workflows | none |
| Branch protection | **none** — must be added before the first feature branch |
| Local copy | cloned to `/home/user/vanny-manager-pro`, clean on `main` |

**Confirmed: this is a genuine greenfield project.** No source code, no dependencies,
no configuration, no prior history. Nothing in the repository constrains the design
below, and no migration or re-baselining is required.

> Note on process: the first audit attempt returned `404` on every endpoint and was
> recorded as **blocked**, not guessed. The repository was made public and the audit
> was re-run. The original blocked result is preserved in `AUDIT.md` §1.

### Carried into Phase 0

- `main` is unprotected — add branch protection (PR required, CI green, no force-push)
  **before** the first feature branch lands.
- Add `.gitignore` and `.env.example` (keys only) as the first commit.
- Vercel: the connected token can read the profile but **cannot list projects**
  (`Access denied`). Sufficient for Phase 0; scopes must be fixed before any deploy.
  **No deployment is planned in this phase.**

---

## 1. Product definition and scope boundary

**VANNY MANAGER PRO** is a multi-tenant, multi-branch business management SaaS for African retail and service businesses.

### 1.1 In scope for v1 (the "operational core")

| Domain | What it does |
|---|---|
| Organizations & branches | A tenant (business) with one or more physical locations |
| Catalog | Products/services, categories, barcodes, prices |
| Inventory | Per-branch stock levels, movements, adjustments, transfers |
| Sales | Point-of-sale, dual-currency payment, change, void/refund |
| Cash sessions | Open/close a till with float and counted variance |
| Customers | Simple customer records with balances (debt tracking) |
| Expenses | Branch expenses, categories, attachments |
| Reports | Read-only aggregation of **real recorded data only** |
| Access control | Owner / Manager / Cashier + Platform Admin |
| PWA | Installable, offline-capable for cashier operations |

### 1.2 Explicitly OUT of scope for v1 (not built, not faked)

Payroll · supplier/purchase orders · loyalty programs · appointments/booking · recipes/BOM · e-invoicing · mobile-money collection (M-Pesa, Airtel, Orange Money) · SMS receipts · multi-language beyond French · accounting exports · delivery/logistics · franchise royalty.

These are **deferred by design, not forgotten**. The schema in §5 is shaped so they can be added without a rewrite. We will not ship a button that does nothing.

### 1.3 Five business sectors — core now, extensions later

All five sectors are **in the architecture from day one** (CTO Decision 3). Full domain
specifications and per-sector acceptance criteria live in **[`SECTORS.md`](./SECTORS.md)**.

v1 delivers the **common operational core** to every sector:

| Sector | v1 (common core) | Extension point preserved |
|---|---|---|
| Retail boutique | products, variants-ready SKU, stock, sales, expenses | variants / sizes / colours |
| Bar | products, bottle-level stock movements, sales, expenses | recipes & bottle-level inventory |
| Restaurant | products, stock, sales, expenses | recipes, kitchen workflows, tables |
| Hair salon | **services** (`products.kind = "service"`), staff, sales, expenses | appointments & commissions |
| Pharmacy | products, batch/expiry flags, stock, sales, expenses | batches, expiry, prescriptions |

**Rule:** a sector is only advertised as operational once its own acceptance criteria in
`SECTORS.md` pass. A salon using v1 has a working POS with services — it does **not** have
appointments, and the UI must not imply otherwise. No empty menu items.

Schema flags that make the extensions possible without a rewrite:
`products.kind` (`product | service`), `products.unit` (`piece|liter|kg|hour|session`),
`products.track_expiry`, `products.batch_required`.

---

## 2. Architecture overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT — PWA (Next.js App Router, React, TanStack Query, Dexie)     │
│                                                                      │
│   ┌───────────────┐   ┌────────────────┐   ┌──────────────────────┐  │
│   │ Online flows  │   │ Offline queue  │   │ Service Worker       │  │
│   │ server comp.  │   │ IndexedDB      │   │ app shell + routes   │  │
│   │ + RSC payload │   │ (Dexie)        │   │ + Background Sync    │  │
│   └───────┬───────┘   └───────┬────────┘   └──────────┬───────────┘  │
└───────────┼───────────────────┼───────────────────────┼──────────────┘
            │ HTTPS             │ /api/sync/*           │
┌───────────▼───────────────────▼───────────────────────▼──────────────┐
│  EDGE / SERVERLESS — Vercel                                          │
│                                                                      │
│   middleware.ts ── locale, session bootstrap, security headers       │
│        │                                                             │
│   ┌────▼──────────────────────────────────────────────────────┐      │
│   │ Route Handlers (/api/*)  ·  Server Actions  ·  RSC         │      │
│   │  ── Zod validation (never trust the client)                │      │
│   │  ── authorize(user, org, permission)                       │      │
│   │  ── tenant scope (orgId, branchIds)                        │      │
│   └────┬──────────────────────────────────────────────────────┘      │
│        │ Drizzle ORM                                                  │
┌───────▼──────────────────────────────────────────────────────────────┐
│  Neon PostgreSQL (shared schema, row-level security)                  │
│   auth.* · org.* · catalog.* · sales.* · cash.* · platform.*          │
│   RLS: current_setting('app.org_id')                                 │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 Rendering strategy

| Concern | Approach |
|---|---|
| First paint | React Server Components — no client fetch waterfall |
| Auth-gated shells | Server layout + `requireUser()` guard |
| Mutations | Server Actions for online forms; Route Handlers for the offline sync API |
| Client cache | TanStack Query v5 for interactive lists, optimistic updates, invalidation |
| Forms | `react-hook-form` + `zod` resolvers |
| Toasts | `sonner` |

Server Actions are **not** used for offline replay: they cannot be queued, retried or made idempotent cleanly. The sync engine uses dedicated versioned REST endpoints (§7).

---

## 3. Multi-tenancy model

### 3.1 Decision: shared schema + application-enforced scope + RLS

| Option | Verdict | Why |
|---|---|---|
| Database per tenant | ❌ | Operational overhead, no benefit at this scale, breaks pooled serverless connections |
| Schema per tenant | ❌ | Migration fan-out, cross-tenant analytics impossible |
| **Shared schema + `org_id` + RLS** | ✅ | Cheap, fast, pooled-connection friendly, enforceable at two layers |

### 3.2 Three-layer defence against cross-tenant leakage

This is the highest-risk area of the product. A single-layer approach is not acceptable.

**Layer 1 — Type system.** A `TenantDb` can only be constructed from a verified membership:

```ts
// the ONLY way to obtain a query handle for tenant data
const db = await getTenantDb();          // throws if no session / no active org
const db = await getTenantDb({ orgId }); // throws if user is not a member of orgId
```

There is no exported `db` handle for tenant tables. `db.select().from(sales)` is not reachable from feature code — only `db.select().from(sales)` on a `TenantDb`, which always injects `org_id` through a Drizzle `$dynamic` wrapper (see `src/db/tenant.ts`).

**Layer 2 — RLS.** Every tenant table gets:

```sql
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_tenant_isolation ON sales
  USING (org_id = current_setting('app.org_id', true)::uuid);
```

`app.org_id` is set per transaction (`SET LOCAL`) — safe under Neon's PgBouncer pooling because it is transaction-scoped. The app role (`vanny_app`) does **not** have `BYPASSRLS`.

**Layer 3 — Tests.** An integration suite that creates org A and org B and asserts that A cannot read, update or delete B's rows through every public access path, plus a direct-SQL RLS test.

### 3.3 Branch scoping

Cashiers do not see the whole organization. Two scopes:

- **`org_id`** — tenant isolation (hard boundary, RLS-enforced).
- **`branch_ids`** — authorization inside the tenant (soft boundary, app-enforced via `member_branch_access`).

Rule: **cashier operations are always branch-scoped**. `getTenantDb()` returns `{ orgId, branchIds, isAllBranches }`; repositories must pass a branch filter when `isAllBranches === false`. A helper `assertBranchAccess(branchId)` throws otherwise.

The offline sync pull is branch-scoped too — a cashier's device must not receive another branch's stock figures.

### 3.4 Platform admin

Platform admins are **not** a role inside the tenant. They live in `platform_admins` and get a separate `/platform/*` surface that reads across tenants through a dedicated, audited path. They do not get `BYPASSRLS` in the app role; instead the platform repository sets `app.org_id` explicitly per query, and every read is written to `audit_log` with `actor`, `org_id`, `reason`.

**v1 rule: no silent impersonation.** If a support agent needs to act inside a tenant, the org owner must grant a time-boxed support grant, and all actions are attributed to the agent. This is deliberately stricter than "admin can see everything".

---

## 4. Authentication and authorization

### 4.1 Better Auth

- Adapter: `better-auth/adapters/drizzle` against the Neon database.
- Methods: email + password (v1). Magic link and OAuth are **not** shipped in v1.
- Session: database-backed sessions, `httpOnly` cookies, 7-day expiry, sliding refresh.
- **Organizations**: Better Auth's organization plugin is the substrate for "multiple organizations per owner" (`organization`, `member`, `invitation` tables). Custom roles `owner`, `manager`, `cashier`.
- **To validate in Phase 0** (I will not assert this before testing): whether Better Auth `1.7.x` accepts custom role definitions with per-role permission arrays in the organization plugin, and whether the Drizzle adapter's generated schema merges cleanly with our own tables. If it does not, we keep Better Auth for identity only and own the membership tables ourselves — a contained change.

### 4.2 Role → permission matrix (v1)

Permissions are a flat string union (`src/lib/permissions.ts`). No wildcards, no `if (role === 'owner')` scattered through the codebase.

| Permission | Owner | Manager | Cashier | Platform Admin |
|---|:--:|:--:|:--:|:--:|
| `org:read` | ✅ | ✅ | ✅ | — |
| `org:update` | ✅ | ❌ | ❌ | — |
| `org:billing` | ✅ | ❌ | ❌ | — |
| `org:delete` | ✅ | ❌ | ❌ | — |
| `branch:manage` | ✅ | ✅ | ❌ | — |
| `staff:manage` | ✅ | ✅ (cashiers only) | ❌ | — |
| `catalog:read` | ✅ | ✅ | ✅ | — |
| `catalog:write` | ✅ | ✅ | ❌ | — |
| `stock:read` | ✅ | ✅ | ✅ | — |
| `stock:adjust` | ✅ | ✅ | ❌ | — |
| `stock:transfer` | ✅ | ✅ | ❌ | — |
| `customer:read` | ✅ | ✅ | ✅ | — |
| `customer:write` | ✅ | ✅ | ✅ | — |
| `sale:create` | ✅ | ✅ | ✅ | — |
| `sale:void` | ✅ | ✅ | ❌ | — |
| `sale:refund` | ✅ | ✅ | ❌ | — |
| `expense:create` | ✅ | ✅ | ✅ (own) | — |
| `expense:approve` | ✅ | ✅ | ❌ | — |
| `cash:open` / `cash:close` | ✅ | ✅ | ✅ (own) | — |
| `report:view` | ✅ | ✅ | ❌ | — |
| `report:export` | ✅ | ✅ | ❌ | — |
| `audit:view` | ✅ | ❌ | ❌ | — |
| `platform:orgs:read` | — | — | — | ✅ |
| `platform:orgs:suspend` | — | — | — | ✅ |
| `platform:audit:read` | — | — | — | ✅ |

Enforcement is **always** server-side. UI hiding is cosmetic; `authorize()` is the law.

```ts
// every server action / route handler starts with this shape
const { orgId, branchIds } = await requireMembership();
await authorize(orgId, "sale:create");
```

---

## 5. Data model

### 5.1 Conventions (non-negotiable)

- **Primary keys: UUID v7** (time-ordered, index-friendly, **generated client-side** so offline devices can create records before the server exists).
- **No auto-increment, no serial.** Ever. They break offline sync and leak volume.
- Money: `bigint` minor units + `currency char(3)`. **Never `float`/`numeric` without a defined scale, never JS numbers.**
- Timestamps: `timestamptz` in UTC. Display in the org's timezone.
- Every tenant table: `org_id uuid NOT NULL`, `created_at`, `updated_at`, `created_by`.
- Append-only ledgers: `sales`, `sale_items`, `payments`, `stock_movements`, `expenses`, `audit_log` are **never updated in place** — only superseded by correcting documents (void/refund/adjustment).
- Soft delete only where a business reason exists (`products`, `customers`); ledgers are never deleted.

### 5.2 Entity map

```
platform_admins
organizations 1──n branches
organizations 1──n members n──1 users
members       n──n branches   (member_branch_access)
organizations 1──n categories 1──n products
branches      1──n branch_stock     (product_id)
branches      1──n stock_movements
organizations 1──n customers
branches      1──n sales 1──n sale_items
                     1──n payments
branches      1──n cash_sessions
branches      1──n expenses
organizations 1──n audit_log
```

### 5.3 Key tables (Drizzle sketch)

```ts
// src/db/schema/org.ts
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  businessSector: businessSectorEnum("business_sector").notNull(),
  baseCurrency: currencyEnum("base_currency").notNull().default("USD"),
  fxRoundingStepCdf: integer("fx_rounding_step_cdf").notNull().default(100),
  timezone: text("timezone").notNull().default("Africa/Kinshasa"),
  logoUrl: text("logo_url"),
  status: orgStatusEnum("status").notNull().default("active"),
  settings: jsonb("settings").$type<OrgSettings>().notNull().default({}),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export const branches = pgTable("branches", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [index("branches_org_idx").on(t.orgId)]);

export const memberBranchAccess = pgTable("member_branch_access", {
  memberId: uuid("member_id").notNull(),
  branchId: uuid("branch_id").notNull(),
}, (t) => [primaryKey({ columns: [t.memberId, t.branchId] })]);
```

```ts
// src/db/schema/catalog.ts
export const products = pgTable("products", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  categoryId: uuid("category_id"),
  name: text("name").notNull(),
  sku: text("sku"),
  barcode: text("barcode"),
  kind: productKindEnum("kind").notNull().default("product"),   // product | service
  unit: text("unit").notNull().default("piece"),                // piece | liter | kg | hour
  // Cost basis stays on the product: it is internal, not customer-facing.
  costUsdMinor: bigint("cost_usd_minor", { mode: "number" }),
  costCdfMinor: bigint("cost_cdf_minor", { mode: "number" }),
  trackExpiry: boolean("track_expiry").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("products_org_sku_uq").on(t.orgId, t.sku),
  index("products_org_barcode_idx").on(t.orgId, t.barcode),
  index("products_org_updated_idx").on(t.orgId, t.updatedAt),  // sync cursor
]);

/**
 * CTO Decision 2 (revised): selling prices live in their own normalized table.
 * One row per (product, currency) — so a product may be USD-only, CDF-only,
 * or carry both. A sale on a price list with no row for that product is
 * REJECTED with PRICE_MISSING. It is never converted.
 */
export const productPrices = pgTable("product_prices", {
  productId: uuid("product_id").notNull(),
  currency: currencyEnum("currency").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.productId, t.currency] })]);

export const branchStock = pgTable("branch_stock", {
  orgId: uuid("org_id").notNull(),
  branchId: uuid("branch_id").notNull(),
  productId: uuid("product_id").notNull(),
  quantity: integer("quantity").notNull().default(0),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.branchId, t.productId] })]);
```

```ts
// src/db/schema/sales.ts
export const sales = pgTable("sales", {
  id: uuid("id").primaryKey(),                       // client-generated, UUIDv7
  orgId: uuid("org_id").notNull(),
  branchId: uuid("branch_id").notNull(),
  cashierId: text("cashier_id").notNull(),
  customerId: uuid("customer_id"),
  number: bigint("number", { mode: "number" }),      // per-org human number, assigned server-side
  status: saleStatusEnum("status").notNull().default("completed"), // completed|voided|refunded
  pricingCurrency: currencyEnum("pricing_currency").notNull(), // price list used for the lines
  fxRateUsdToCdf: integer("fx_rate_usd_to_cdf").notNull(),     // rate SNAPSHOT at sale time
  changeRoundingStepCdf: integer("change_rounding_step_cdf").notNull().default(100),
  subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
  discountMinor: bigint("discount_minor", { mode: "number" }).notNull().default(0),
  totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
  paidUsdMinor: bigint("paid_usd_minor", { mode: "number" }).notNull().default(0),
  paidCdfMinor: bigint("paid_cdf_minor", { mode: "number" }).notNull().default(0),
  changeUsdMinor: bigint("change_usd_minor", { mode: "number" }).notNull().default(0),
  changeCdfMinor: bigint("change_cdf_minor", { mode: "number" }).notNull().default(0),
  operationId: uuid("operation_id").notNull(),       // idempotency key
  clientCreatedAt: timestamptz("client_created_at").notNull(),
  syncedAt: timestamptz("synced_at"),
}, (t) => [
  uniqueIndex("sales_operation_uq").on(t.operationId),
  uniqueIndex("sales_org_number_uq").on(t.orgId, t.number),
  index("sales_branch_created_idx").on(t.branchId, t.clientCreatedAt),
  index("sales_org_updated_idx").on(t.orgId, t.syncedAt),
]);
```

```ts
// src/db/schema/cash.ts
export const cashSessions = pgTable("cash_sessions", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  branchId: uuid("branch_id").notNull(),
  registerId: uuid("register_id").notNull(),  // the PHYSICAL drawer unit
  currency: currencyEnum("currency").notNull(), // separate USD and CDF balances
  cashierMemberId: text("cashier_member_id").notNull(), // a PERSON, never a register
  status: cashSessionStatusEnum("status").notNull().default("open"),
  openedAt: timestamptz("opened_at").notNull(),
  closedAt: timestamptz("closed_at"),
  openingFloatMinor: bigint("opening_float_minor", { mode: "number" }).notNull().default(0),
  expectedMinor: bigint("expected_minor", { mode: "number" }),   // float + takings - refunds
  countedMinor: bigint("counted_minor", { mode: "number" }),
  varianceMinor: bigint("variance_minor", { mode: "number" }),   // counted - expected
  note: text("note"),
}, (t) => [
  // at most one OPEN session per PHYSICAL REGISTER per currency
  uniqueIndex("cash_session_open_uq")
    .on(t.registerId, t.currency)
    .where(sql`${t.status} = 'open'`),
]);
```

Also created: `stock_movements`, `customers`, `sale_items`, `payments`, `expenses`, `expense_categories`, `audit_log`, `sync_operations`, `fx_rate_history`, plus Better Auth's `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`.

### 5.4 Dual-currency model (USD / CDF) — CTO Decision 2

**Prices are normalized, not columns.** `product_prices` holds one row per
`(product, currency)`, so a product may be **USD-only, CDF-only, or both**. Nothing is
derived. The exchange rate exists only to settle cross-currency tender and to consolidate
reports — never to compute a shelf price, and never to fill a missing price.

| Rule | Implementation |
|---|---|
| Independent prices | `product_prices(productId, currency, amount_minor)` — unique per pair |
| Org-level rate | `org_fx_rates(org_id, usd_to_cdf, effective_from, set_by, reason)` — versioned history |
| Historical snapshot | `sales.fx_rate_usd_to_cdf` — frozen at sale time, **never recomputed** |
| Transaction currency | `sales.pricing_currency` — which price list the receipt is drawn from |
| Mixed payments | `payments` rows, each with its own `currency`; totals per currency on the sale |
| Exact change | Integer minor-unit arithmetic + per-org `change_rounding_step_cdf` |
| Currency-specific registers | `cash_sessions.currency` — one open session per branch per currency |
| Currency-specific reports | Every report filters by currency before summing |
| Consolidated reports | Explicit conversion row showing the **rate snapshot used**, per period |

#### Why not one price + rate

A single USD price converted at the till makes every CDF receipt dependent on a rate that
moves daily. If the merchant changes the rate, the shelf price of a 5,000 CDF beer silently
becomes 5,500 CDF without the merchant ever deciding that. Independent prices make the
merchant's intent explicit and auditable.

#### Sale construction

```
1. Cashier selects price list: USD or CDF        (org default, switchable per sale)
2. Line unit price = products.price_<list>_minor (the merchant's number, unchanged)
3. Totals computed in that currency, integer minor units
4. Payment: one or more tender rows, each { currency, amount }
5. Change computed against the org rate snapshot:
      change_<cur> = (paid_<cur> - total_<cur>) ± cross-currency leg at fx_rate
   rounded to the org's `change_rounding_step_cdf` (default 100 CDF)
6. fx_rate_usd_to_cdf + pricing_currency + change_rounding_step written to the sale
```

#### Invariants enforced in code and in tests

- `sum(payments.usd) - change.usd` and `sum(payments.cdf) - change.cdf` reconcile to the
  sale total at the snapshotted rate — for **every** combination of tender and change.
- Changing `org_fx_rates` never mutates an existing sale (regression test).
- A product with `price_cdf_minor` unset is rejected at write time — both prices are mandatory.
- Consolidated reports state the rate used and never sum raw CDF + raw USD.

#### Rounding

CDF has no sub-unit in practice; USD has cents. `lib/money.ts` owns a per-currency exponent
table (`USD: 2`, `CDF: 0`) and all rounding. **No `Math.round` on money anywhere else.**

---

### 5.5 Cash model — register ≠ cashier ≠ currency ≠ session

Four concepts that must never be conflated. Getting this wrong produces a daily close that
cannot be reconciled against physical cash.

| Concept | Table / column | Meaning | Cardinality |
|---|---|---|---|
| **Physical register** | `cash_registers` | A drawer / till unit in a branch | **many per branch** |
| **Cashier** | `cash_sessions.cashier_member_id` | A person (Better Auth member) | many per branch |
| **Currency** | `cash_sessions.currency` | USD and CDF are separate balances | 2 |
| **Cash session** | `cash_sessions` | One cashier's shift, on one register, in one currency | many per register |

```
branch 1 ──── registers 1..n
                 │
                 ├── register "C1"
                 │     ├── USD balance ── session (cashier A, 08:00–14:00)  CLOSED
                 │     │                └─ session (cashier B, 14:00–22:00)  OPEN   ← handover
                 │     └── CDF balance ── session (cashier A, 08:00–22:00)  OPEN
                 │
                 └── register "C2"
                       └── ...
```

**Invariant (enforced by a partial unique index):**

```sql
UNIQUE (register_id, currency) WHERE status = 'open'
```

Postgres rejects a second open session on the same register + currency outright — not the
application, the database. A cashier cannot open a drawer that is already open.

#### Handover procedure

When cashier B takes over register C1 / USD from cashier A:

1. A counts the drawer and closes their session. `counted`, `expected`, `variance` are written.
2. B opens a new session with `handover_from_session_id = A's session` and
   `opening_float_minor = A's counted`.
3. Both writes happen in one transaction — a half-completed handover is not possible.
4. The chain `A → B → C` is auditable; every session names its predecessor.

This matters because a shift change in a busy bar is exactly when money goes missing.

---

### 5.6 Device registry and revocation — CTO Decision 5

Offline devices hold tenant data, so a lost phone is a data incident. Every device is a
first-class record.

```ts
export const devices = pgTable("devices", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  branchId: uuid("branch_id").notNull(),
  memberId: uuid("member_id").notNull(),
  label: text("label").notNull(),              // "Cashier 2 — Tecno Spark 8"
  platform: text("platform"),                  // android | ios | desktop
  lastSeenAt: timestamptz("last_seen_at"),
  lastSyncCursor: timestamptz("last_sync_cursor"),
  revokedAt: timestamptz("revoked_at"),
  revokedBy: text("revoked_by"),
  revokeReason: text("revoke_reason"),
}, (t) => [index("devices_org_idx").on(t.orgId, t.branchId)]);
```

- Sync endpoints authenticate **device + member**, not member alone.
- Revocation is immediate: the next `push`/`pull` returns `401 DEVICE_REVOKED`.
- On `401 DEVICE_REVOKED` the client **wipes local tenant data** (Dexie `delete()`) and returns
  to login. This is the only path that destroys the outbox, and it is intentional.
- `operation_id` uniqueness is scoped per device, so two devices cannot collide.
- Revocation is audited (`audit_log`, action `device.revoke`).

---

## 6. Offline & PWA architecture

### 6.1 Positioning — CTO Decision 1

Online-first development, offline engine built in Phase 5 — **but offline is a mandatory
commercial launch requirement, not a nice-to-have.** The launch gate includes a passing
real-device test (§6.7). Until that test passes on physical hardware, offline is described
internally and externally as *in development*, never as production-ready.

The four operations that must work offline: **sales, inventory operations, customer creation
and lookup, expense recording.** Anything else (reports, settings, staff, billing) is
online-only by design and says so in the UI.

### 6.2 What is prepared from day one (not deferred)

These are cheap now and expensive later:

- UUIDv7 client-generated IDs on every table.
- `operation_id` unique index on every mutable entity → idempotent replay.
- `updated_at` on every synced table → delta pull cursor.
- Append-only ledgers → no update conflicts to resolve.
- Timestamps as `client_created_at` + `synced_at` (never overwritten).
- All read endpoints shaped as `{ cursor, changes, deleted }` from the start.

### 6.3 Runtime stack

| Layer | Choice |
|---|---|
| Service worker | `@serwist/next` (Workbox-based), app-shell precache, runtime caching |
| Local store | **Dexie** (IndexedDB) — mirrors the server tables the device needs |
| Queue | Dexie `outbox` table, per-op status, exponential backoff |
| Sync triggers | `online` event, visibilitychange, Background Sync where supported, manual retry |
| PWA metadata | `public/manifest.webmanifest`, maskable icons, `display: standalone` |

### 6.4 Sync protocol

**Push** — `POST /api/sync/push`

```json
{ "deviceId": "uuid", "ops": [ { "opId": "uuidv7", "entity": "sale", "id": "uuidv7", "payload": { }, "clientCreatedAt": "..." } ] }
```

Response, per op: `{ opId, status: "applied" | "duplicate" | "rejected", error?, canonicalId? }`.

- `duplicate` means the `operation_id` was already processed — the server returns the canonical record and the client drops the op. **This makes retries safe.**
- `rejected` carries a machine-readable code (`INSUFFICIENT_STOCK`, `FORBIDDEN`, `INVALID`, `CONFLICT_MERGE`).

**Pull** — `GET /api/sync/pull?cursor=<iso>&scope=branch:<id>`

```json
{ "cursor": "2026-11-24T10:00:00.000Z",
  "changes": { "products": [...], "customers": [...], "branchStock": [...] },
  "deleted": { "products": ["uuid", ...] } }
```

Pull is **branch-scoped** and **membership-scoped** server-side. A cashier's device never receives another branch's stock.

### 6.5 Conflict policy

| Entity | Policy | Rationale |
|---|---|---|
| `sales`, `sale_items`, `payments` | **Append-only, no conflict** | Each sale is a unique document |
| `stock_movements` | Append-only; stock recomputed from movements | Never "merge" a quantity |
| `customers` | Merge on normalized phone | Offline duplicates are collapsed; server returns canonical id, client remaps |
| `expenses` | Append-only | Unique `operation_id` |
| `products` | Server-wins on conflict | Only managers edit; rare offline case |
| `cash_sessions` | Server-wins on close | Counted figures must be reconciled, not merged |

Stock is never decremented "offline and reconciled later" by editing a number: the device writes a `stock_movement` with `sale:<id>` reference; the server recomputes `branch_stock` from movements. Offline stock display is an optimistic projection.

### 6.6 Scope limit (deliberate)

Offline is available to **cashier-scoped operations**: create sale, capture customer, record expense, read catalog/stock, adjust stock (manager). Owner/manager analytics, settings, staff management and billing are **online-only** — they are shown with a clear "requires connection" state, never a fake cached chart.

### 6.7 Mandatory acceptance test — real device

**This is a launch gate, not a nice-to-have.** It runs on physical hardware, not emulation.

| Step | Action | Expected |
|---|---|---|
| 1 | Android device, airplane mode ON | App loads from service worker; offline banner shown |
| 2 | Create a sale, mixed USD/CDF, change in CDF | Sale queued in outbox; receipt renders locally |
| 3 | Record an expense; create a customer; adjust stock (manager) | All queued with UUIDv7 ids |
| 4 | Close and reopen the browser; reload twice | Outbox survives; nothing lost |
| 5 | **Reconnect** | Push drains; pull reconciles |
| 6 | Assert on server | Exactly **one** sale per `operation_id`; stock equals expected; cash session totals correct |
| 7 | Kill network mid-sync, reconnect | Retries resume; no duplicates |
| 8 | Revoke the device from another session | Device gets `401 DEVICE_REVOKED`, wipes local data, returns to login |

Pass criteria: all 8 steps green on at least **one low-end Android device** and one mid-range
device. Recorded, with video or screenshots, in `docs/offline-acceptance/`.

### 6.8 Simultaneous offline sales

Two devices selling the same product offline is the hardest case: both decrement local stock,
neither knows about the other.

- Neither device writes to `branch_stock`. Both emit `stock_movement` rows referencing their sale.
- Server recomputes `branch_stock` from movements in arrival order.
- If the combined movement drives stock negative, the server **does not silently clamp** — it
  records the sale (money already changed hands) and raises a `STOCK_NEGATIVE` exception for the
  manager to reconcile. Negative stock is visible, not hidden.
- Test: two devices, same product, qty 1 each, stock 1 → after sync, stock = −1 and one
  exception row exists.

---

---

## 7. API design

| Method | Path | Purpose |
|---|---|---|
| `*` | `/api/auth/[...all]` | Better Auth handler |
| `POST` | `/api/sync/push` | Batch offline mutations, idempotent |
| `GET` | `/api/sync/pull` | Delta pull, branch-scoped |
| `GET` | `/api/sync/status` | Device queue state, server cursor |
| `POST` | `/api/webhooks/*` | Reserved — **not implemented in v1** |

Rules:

- Every handler: `requireMembership()` → `authorize()` → Zod parse → `getTenantDb()`.
- Zod schemas live in `src/features/<feature>/schemas.ts` and are **shared** with the client.
- No handler returns a tenant row without the `org_id` filter path.
- Rate limits: auth endpoints and `/api/sync/push` (DB-backed or Upstash; decided in Phase 0).
- Errors: a single `AppError` shape `{ code, message, fieldErrors? }`; never leak SQL or stack traces.

---

## 8. Internationalization

- **Library**: `next-intl` v4.
- **Routing**: `src/app/[locale]/...`; `/` redirects to `/fr` via `Accept-Language` + cookie.
- **Default**: `fr`. `en` and `sw` are **fully wired but not enabled** — message files exist and the build type-checks them, so activation is a config change, not a project.
- Namespaces split per feature (`common`, `auth`, `sales`, `inventory`, `cash`, `settings`, `platform`) to keep bundles small.
- **Formatting is locale-aware and currency-aware**: `Intl.NumberFormat("fr-CD", { currency: "CDF" })` and `fr-CD` for dates. Amounts are always rendered with an explicit currency symbol.
- **No translated strings in the database** for system enums; UI labels come from message files.

---

## 9. Design system

Reference: white-dominant, electric blue primary, red accent, rounded cards, simple icons, mobile-first.

### 9.1 Tokens (CSS variables, Tailwind v4 `@theme`)

```
--background        #FFFFFF
--surface           #F6F8FC
--surface-raised    #FFFFFF
--border            #E4E9F2
--foreground        #0B1220
--muted-foreground  #64748B
--primary           #0B5CFF   (electric blue)
--primary-hover     #0949CC
--primary-soft      #EAF0FF
--accent            #E5252C   (red)
--accent-soft       #FDEBEC
--success           #12833B
--warning           #B45309
--radius-card       1.25rem
--radius-control    0.75rem
--shadow-card       0 1px 2px rgb(16 24 40 / .04), 0 8px 24px rgb(16 24 40 / .06)
```

### 9.2 Type

`Plus Jakarta Sans` (Latin Extended, good diacritic coverage for French/Swahili) with system fallbacks. Scale: 12 / 14 / 16 / 20 / 24 / 32 / 40. Numeric tabular figures for all money (`font-variant-numeric: tabular-nums`).

### 9.3 Layout rules

- **Mobile (< 768px)**: single column, sticky bottom navigation (max 5 items), 56px bar, large tap targets (≥ 44px), POS keypad as the primary input.
- **Tablet (768–1279px)**: two-pane, collapsible rail.
- **Desktop (≥ 1280px)**: persistent left sidebar, data tables, multi-column forms.
- Cards: `rounded-card`, `border`, `shadow-card`, white on `--surface`.
- Icons: `lucide-react`, 1.75px stroke, 20px in lists / 24px in nav.
- Red is **reserved** for destructive actions, errors and negative variance — never decorative.
- Every screen must handle the offline state, the empty state and the permission-denied state.

---

## 10. Security

| Control | Implementation |
|---|---|
| Input validation | Zod on every server entry point; client validation is UX only |
| Authorization | `authorize(orgId, permission)` — no exceptions |
| Tenant isolation | 3-layer model (§3.2) + integration tests |
| Session | httpOnly, Secure, SameSite=Lax; 7d expiry |
| CSRF | Server Actions origin check; Better Auth origin allowlist |
| Headers | CSP (no `unsafe-eval` in prod), `X-Frame-Options: DENY`, `Referrer-Policy`, HSTS |
| Secrets | Server-only env; CI grep fails the build if a `NEXT_PUBLIC_*` var matches `/SECRET|KEY|TOKEN/` |
| Secrets in repo | `.env*` gitignored except `.env.example`; gitleaks in CI |
| Rate limiting | Auth + sync endpoints |
| Audit | `audit_log` for auth events, voids, refunds, stock adjustments, staff changes, FX changes, platform access |
| File uploads | Receipt images only, type + size validated, Vercel Blob, never served from the app origin |
| Dependencies | `pnpm audit` + Renovate in CI; lockfile committed |
| Backups | Neon point-in-time restore (verify retention on the chosen plan) |
| Data protection | DRC data-protection obligations to be confirmed with local counsel before launch — not assumed |

---

## 11. Environment variables

`NEXT_PUBLIC_` = shipped to the browser. **Never** put a secret there.

| Variable | Required | Scope | Purpose |
|---|:--:|---|---|
| `DATABASE_URL` | ✅ | server | Neon pooled connection (PgBouncer, `?sslmode=require`) |
| `DIRECT_URL` | ✅ | server | Neon direct connection — migrations only (no pooler) |
| `BETTER_AUTH_SECRET` | ✅ | server | Session/JWT signing — 32+ byte random |
| `BETTER_AUTH_URL` | ✅ | server | Canonical app URL (must match deployment origin) |
| `NEXT_PUBLIC_APP_URL` | ✅ | both | Canonical public URL |
| `NEXT_PUBLIC_APP_ENV` | ✅ | both | `local` \| `preview` \| `production` |
| `APP_VERSION` | ⬜ | both | Git SHA injected at build |
| `BLOB_READ_WRITE_TOKEN` | ⬜ | server | Vercel Blob for receipt images (Phase 4) |
| `RESEND_API_KEY` / `RESEND_FROM` | ⬜ | server | Transactional email — invites, receipts (Phase 4) |
| `CRON_SECRET` | ⬜ | server | Protect scheduled jobs |
| `SENTRY_DSN` / `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | ⬜ | both | Error tracking (Phase 6) |
| `NEON_PROJECT_ID` | ⬜ | CI | Branching in CI workflows |
| `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | ⬜ | CI | Deploy from CI |

Not env vars (deliberate): platform admin list, feature flags, FX rates, org settings → all in the database, because they are per-tenant or auditable.

---

## 12. Database setup

### 12.1 Neon project

- **Region**: choose the lowest-latency option for DRC. `eu-west-1` (Ireland) is the safe default; `af-south-1` (Cape Town) if Neon offers it on the plan — **verify at Phase 0**. Fungurume → Johannesburg ≈ 60–90 ms; → Dublin ≈ 180–220 ms.
- **Compute**: smallest autosuspend tier for dev; sized up after load testing. No premature scaling.
- **Branching**: `main` = production; `develop` = staging; ephemeral branch per PR for integration tests.

### 12.2 Roles

| Role | Used by | Rights |
|---|---|---|
| `vanny_owner` | migrations (`DIRECT_URL`) | DDL, `BYPASSRLS` |
| `vanny_app` | runtime (`DATABASE_URL`) | DML only, RLS **enforced**, no DDL |

### 12.3 Extensions

`pgcrypto` (if < PG13), `pg_trgm` (product/customer search), `unaccent` (accent-insensitive French search).

### 12.4 Migration flow

```
schema change (src/db/schema/*.ts)
  → pnpm db:generate            # drizzle-kit generate → SQL file in src/db/migrations
  → review the SQL diff in the PR
  → CI: apply to a Neon preview branch, run integration tests
  → merge to main → GitHub Action: drizzle-kit migrate (DIRECT_URL)
```

- Generated SQL is committed and reviewed like code. **No `db push` in CI or production.**
- Every migration must be reversible or forward-only-safe with a documented backfill.
- Seed script exists for **local/preview only** and is guarded by `NODE_ENV !== "production"`.

---

## 13. Proposed folder structure

```
vanny-manager-pro/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                 # typecheck, lint, test, build, RLS tests
│   │   ├── preview-db.yml         # Neon branch per PR
│   │   └── release.yml            # gated — disabled until launch approval
│   └── CODEOWNERS
├── docs/
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   └── adr/                       # architecture decision records
│       ├── 0001-shared-schema-rls.md
│       ├── 0002-better-auth-orgs.md
│       ├── 0003-uuidv7-client-ids.md
│       └── 0004-append-only-ledgers.md
├── drizzle.config.ts
├── next.config.ts
├── tsconfig.json                  # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
├── postcss.config.mjs
├── package.json                   # pnpm, packageManager pinned
├── pnpm-lock.yaml
├── .env.example                   # keys only, no values
├── .gitignore
├── public/
│   ├── manifest.webmanifest
│   ├── icons/                     # 192, 512, maskable
│   └── robots.txt
└── src/
    ├── app/
    │   ├── layout.tsx                        # root: fonts, theme, metadata
    │   ├── globals.css                       # Tailwind v4 @theme tokens
    │   ├── not-found.tsx
    │   ├── error.tsx
    │   ├── offline.tsx                       # offline fallback page
    │   ├── manifest.webmanifest/route.ts
    │   ├── api/
    │   │   ├── auth/[...all]/route.ts
    │   │   ├── sync/{push,pull,status}/route.ts
    │   │   └── health/route.ts
    │   └── [locale]/
    │       ├── layout.tsx                    # next-intl provider
    │       ├── (auth)/
    │       │   ├── login/page.tsx
    │       │   ├── register/page.tsx
    │       │   ├── verify/page.tsx
    │       │   └── forgot-password/page.tsx
    │       ├── (public)/page.tsx             # fr landing
    │       ├── (app)/app/                    # tenant surface
    │       │   ├── layout.tsx                # session + org guard
    │       │   ├── page.tsx                  # dashboard (real aggregates only)
    │       │   ├── sales/
    │       │   │   ├── page.tsx              # list
    │       │   │   ├── new/page.tsx          # POS
    │       │   │   └── [id]/page.tsx         # detail / void / refund
    │       │   ├── inventory/
    │       │   │   ├── page.tsx
    │       │   │   ├── products/[id]/page.tsx
    │       │   │   ├── adjustments/page.tsx
    │       │   │   └── transfers/page.tsx
    │       │   ├── customers/page.tsx
    │       │   ├── expenses/page.tsx
    │       │   ├── cash/page.tsx
    │       │   ├── reports/page.tsx
    │       │   ├── staff/page.tsx
    │       │   ├── branches/page.tsx
    │       │   └── settings/
    │       │       ├── page.tsx
    │       │       ├── organization/page.tsx
    │       │       └── fx-rates/page.tsx
    │       └── (platform)/platform/
    │           ├── layout.tsx                 # platform admin guard
    │           ├── orgs/page.tsx
    │           ├── orgs/[id]/page.tsx
    │           └── audit/page.tsx
    ├── components/
    │   ├── ui/                   # shadcn primitives
    │   ├── layout/               # app-shell, sidebar, bottom-nav, header
    │   ├── shared/               # money, status-badge, empty-state, offline-banner
    │   └── providers/            # query-client, theme, toaster
    ├── features/                 # vertical slices — the real logic lives here
    │   ├── auth/
    │   ├── org/{components,schemas,actions,queries}
    │   ├── sales/{components,schemas,actions,queries}
    │   ├── inventory/{components,schemas,actions,queries}
    │   ├── customers/{components,schemas,actions,queries}
    │   ├── expenses/{components,schemas,actions,queries}
    │   ├── cash/{components,schemas,actions,queries}
    │   ├── reports/{components,queries}
    │   └── platform/{components,schemas,actions}
    ├── db/
    │   ├── client.ts             # neon serverless + drizzle singleton
    │   ├── tenant.ts             # TenantDb + orgId injection (the ONLY door)
    │   ├── rls.ts                # SET LOCAL app.org_id helpers
    │   ├── schema/
    │   │   ├── auth.ts
    │   │   ├── org.ts
    │   │   ├── catalog.ts
    │   │   ├── sales.ts
    │   │   ├── customers.ts
    │   │   ├── expenses.ts
    │   │   ├── cash.ts
    │   │   └── platform.ts
    │   ├── index.ts              # re-exports schema (no db handle)
    │   └── migrations/           # generated SQL, committed
    ├── lib/
    │   ├── auth.ts               # better-auth server client
    │   ├── permissions.ts        # role → permission map + authorize()
    │   ├── membership.ts         # requireMembership / requireUser
    │   ├── money.ts              # minor units, currency exponents, rounding
    │   ├── fx.ts                 # rate resolution + snapshotting
    │   ├── i18n/{config,routing,request}.ts
    │   ├── offline/
    │   │   ├── db.ts             # Dexie schema
    │   │   ├── queue.ts          # outbox + backoff
    │   │   ├── sync.ts           # push/pull orchestration
    │   │   └── resolvers.ts      # per-entity conflict policy
    │   ├── pwa/                  # serwist config, register component
    │   ├── errors.ts             # AppError
    │   └── utils.ts
    ├── messages/{fr,en,sw}.json
    ├── types/{api,entities}.ts
    └── middleware.ts
└── tests/
    ├── setup/{db,seed}.ts
    ├── unit/                     # money, fx, permissions, zod schemas
    ├── integration/              # tenant isolation, RLS, idempotency, stock math
    └── e2e/                      # Playwright: auth, sale, offline sale, cash close
```

**Dependency rule:** `app/` → `features/` → `db/` → `lib/`. Never the reverse. `features/` may not import from another `feature/` — shared logic goes to `lib/` or `components/shared/`.

---

## 14. Testing strategy

| Layer | Tool | What it proves |
|---|---|---|
| Unit | Vitest | money math, FX rounding, permission matrix, Zod schemas |
| Integration | Vitest + real Postgres (Neon branch) | **tenant isolation (A≠B)**, RLS policies, idempotency, stock recomputation |
| Component | Vitest + Testing Library | forms, validation states |
| E2E | Playwright | login → sale → receipt; offline network-cut flows |
| Real device | Manual, recorded | **offline acceptance §6.7** — launch gate |
| Security | Custom script | every tenant table has RLS enabled; no unscoped query |
| Restore | Drill | Neon PITR restore into a scratch branch, verified row-for-row |
| CI | GitHub Actions | blocks merge on any failure |

The tenant-isolation test is a **merge blocker**, not a nice-to-have.

### 14.1 Mandatory test list — CTO Decision 5

These are named, owned tests. A missing one blocks the release.

| # | Test | Level | Asserts |
|---|---|---|---|
| T1 | **Mixed-currency payments** | Integration | Every tender×change combination reconciles to the total at the snapshot rate |
| T2 | **Simultaneous offline sales** | E2E + integration | Two devices, same product, network cut → no duplicate sale, stock = expected, exception row if negative |
| T3 | **Inventory consistency** | Integration | `branch_stock == sum(movements)` invariant holds after sales, voids, refunds, transfers, adjustments |
| T4 | **Cross-tenant access prevention** | Integration + RLS | Org A cannot read/write/delete Org B by any path; unscoped SQL returns 0 rows |
| T5 | **Device revocation** | Integration + E2E | Revoked device receives `401 DEVICE_REVOKED`, local data wiped, cannot push or pull |
| T6 | **Database restoration** | Drill | PITR restore of a scratch branch matches source row counts and totals; timed and documented |

Additional: `T7` FX change never revalues history · `T8` idempotent push (5× same op → 1 row) ·
`T9` branch scoping for cashiers · `T10` sale immutability on void/refund.

---

## 15. Deployment (prepared — NOT executed)

Nothing will be deployed in this phase. When approved:

1. Vercel project linked to the GitHub repo, framework preset **Next.js**, pnpm.
2. Env vars configured per environment (Preview / Production) — never committed.
3. `vercel.json` for `DATABASE_URL` pooling and function regions matching the Neon region.
4. Preview deploys per PR against a Neon preview branch.
5. Production deploy **only** on an explicit approval, after Phase 6 sign-off.

---

## 16. Resolved package versions

Checked against the npm registry on **2026-11-24**:

| Package | `latest` |
|---|---|
| `next` | 16.4.6 |
| `react` | 19.3.1 |
| `typescript` | **5.9.3** |
| `drizzle-orm` | 0.45.4 |
| `drizzle-kit` | 0.31.11 |
| `better-auth` | 1.7.27 |
| `@tanstack/react-query` | 5.108.4 |
| `tailwindcss` | 4.3.5 |
| `zod` | 4.6.7 |
| `next-intl` | 4.16.1 |
| `@serwist/next` | 9.5.15 |
| `@neondatabase/serverless` | 1.2.1 |
| `dexie` | 4.4.7 |
| `react-hook-form` | 7.92.0 |
| `sonner` | 2.0.8 |

### Verification verdict — executed 2026-11-24

Full report with commands and logs: **[`DEPENDENCY-COMPAT.md`](./DEPENDENCY-COMPAT.md)**.

| Result | Detail |
|---|---|
| ✅ `next build --webpack` | **EXIT 0** — compiled, type-checked, static pages generated |
| ⚠️ `next build --turbopack` | **EXIT 0 but emits NO service worker** — silent failure |
| ⚠️ TypeScript 7.0.2 | typecheck passes with `skipLibCheck`, but **`typescript-eslint` does not support TS 7** → pinned to 5.9.3 (ADR-0010) |
| ✅ TypeScript 5.9.3 | typecheck + lint + build all exit 0 |
| ✅ Drizzle Kit | generated a correct migration from the schema |
| ✅ Better Auth 1.7.27 | org plugin + custom roles + access control compile |
| ✅ Tailwind 4 / Zod 4 / next-intl 4 / Dexie 4 / TanStack 5 | compile clean |

**Three binding decisions came out of the verification:**

1. **Production builds use `next build --webpack`.** Turbopack returns success while emitting
   no `sw.js` — the PWA would silently have no offline capability. This is exactly the class
   of defect the "no fake functionality" rule exists to prevent.
2. **`skipLibCheck: true` is mandatory.** Without it the build fails on TypeScript's own
   bundled lib definitions, and under 5.9.3 on drizzle-orm's optional peer `.d.ts` files.
   This is Next's default and is recorded in ADR-0008.
3. **TypeScript is pinned to 5.9.3, not 7.** TS 7 typechecks and builds, but `typescript-eslint`
   does not support it and refuses to initialise — **no lint rules would run at all**. A
   passing `tsc` and a passing build said nothing about ESLint. ADR-0010.

---

## 17. Decisions resolved by CTO review

| # | Decision | Status |
|---|---|---|
| 1 | Offline: online-first build, offline engine Phase 5, **mandatory for launch** | ✅ accepted |
| 2 | USD/CDF: **independent merchant-set prices**, org rate, snapshots, per-currency registers | ✅ accepted — schema in §5.4 |
| 3 | All five sectors from day one; per-sector specs + acceptance criteria | ✅ accepted — see `SECTORS.md` |
| 4 | Repository goes **private** before the first implementation commit | ⛔ **blocked — needs GitHub admin scope** |
| 5 | Retain tenancy/RLS/UUIDv7/idempotency/append-only; add the six named tests | ✅ accepted — see §14.1 |

### Still open

1. **Repository visibility** — I cannot flip `public → private` without a token carrying
   `repo` admin scope, and the GitHub connector is unsupported in this environment.
   Instructions and the access-preservation plan are in `GITHUB-SECURITY.md`.
2. **Branch protection** — same blocker. The exact rule set is specified and ready to apply.
3. **Neon provisioning** — no account is connected. Instructions in `NEON-SETUP.md`.
4. **DB round-trip** — untested for lack of credentials. This is the one Phase-0 gate
   that cannot be closed from this sandbox.
