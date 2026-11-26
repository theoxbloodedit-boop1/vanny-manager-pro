# VANNY MANAGER PRO — Sector Domain Specifications

> Status: **PROPOSED — awaiting review.**
> CTO Decision 3: all five sectors are in the architecture from day one.
> Rule: **a sector is only advertised as operational once its own acceptance criteria pass.**

---

## 0. How to read this document

- **§1 Common core** — what every sector gets in v1.
- **§2–§6 Per sector** — domain model deltas, workflows, reports, acceptance criteria,
  and the extension points that are *reserved but not built*.
- **Status column** is binding:
  - `v1` — delivered in the first release.
  - `reserved` — schema supports it, UI does not exist, nothing is advertised.
  - `later` — planned phase, not started.

The single most important rule in this document: **if a sector's acceptance criteria have not
passed, that sector is not "fully operational" and the product must not say it is.**

---

## 1. Common core — delivered to every sector in v1

All five sectors share one operational spine. Building it once is the whole point of the
architecture; sector differences live in *configuration and extension*, not in forks.

| Capability | Detail |
|---|---|
| Catalog | Products and services, categories, SKU, barcode, unit. Prices in `product_prices`, one row per currency — a product may be USD-only, CDF-only or both |
| Stock | Per-branch levels derived from movements; adjustments; transfers |
| Sales | POS, price list currency, mixed USD/CDF tender, exact change, void, refund |
| Cash | Per-currency registers, opening float, counted close, variance |
| Customers | Name, phone, balance, home branch |
| Expenses | Categories, entry, approval, receipt attachment |
| Reports | Currency-specific + consolidated with explicit conversion |
| Access | Owner / manager / cashier, branch-scoped |
| Offline | Sales, inventory, customers, expenses — Phase 5, launch-gated |

### 1.1 Shared invariants (every sector, no exception)

- `branch_stock == sum(stock_movements)` — always.
- A completed sale is immutable; corrections are documents.
- Money is integer minor units with an explicit currency, never a float.
- Every document snapshots the FX rate in force.
- Nothing is deleted from a ledger.

---

## 2. Retail boutique

The reference sector. Highest SKU count, highest variant pressure.

### 2.1 Domain model in v1

| Entity | Notes |
|---|---|
| `products` | `kind = product`, `unit = piece`, both prices required |
| `categories` | Typically 2 levels (Homme > Chemises) — v1 supports flat + optional parent |
| `branch_stock` | Per branch; boutiques rarely share stock |
| `customers` | Optional; used for loyalty later |

### 2.2 v1 workflows

1. Receive stock (manual opening balance or adjustment) — per branch.
2. Sell: scan barcode or search by name → cart → mixed tender → receipt.
3. Daily: open register (USD + CDF), sell, count, close, review variance.
4. Weekly: low-stock review, transfer between branches.

### 2.3 Reports in v1

Daily sales by branch and cashier · payment-method split (USD/CDF/mixed) · stock value at
cost, per currency · stock movement log · cash variances.

### 2.4 Acceptance criteria — boutique

- [ ] A barcode scan resolves to the right product in < 300 ms on a low-end Android device.
- [ ] Selling an item with only a CDF price and a USD price-list active is **blocked** with a
      clear message, never silently converted.
- [ ] Mixed tender with change in the other currency reconciles exactly.
- [ ] Stock value report equals `sum(qty × cost)` per currency, and states which cost basis.
- [ ] A transfer between two branches updates both branches atomically.

### 2.5 Reserved (not built in v1)

`product_variants` (size, colour), barcode-per-variant, variant-level stock, price overrides
per variant. **Schema hook:** `products.parent_product_id` + `variant_attributes jsonb`
added in Phase 2 so v2 variants do not require a table rewrite.

---

## 3. Bar

Highest transaction velocity, smallest ticket, most cash, latest hours.

### 3.1 Domain model in v1

| Entity | Notes |
|---|---|
| `products` | Drinks and snacks; `unit = bottle` / `piece` |
| `branch_stock` | Bottle-level quantities (not recipe-level) |
| `cash_sessions` | Critical — high cash volume, must close every night |

### 3.2 v1 workflows

1. Open bar: open both registers with float.
2. Sell at speed: favourites row, barcode, or search; single-tap quantity.
3. Shift change mid-service: close one session, open the next, variance per cashier.
4. Close: count both currencies, explain variance, sign off.

### 3.3 Performance requirement (specific to this sector)

A bartender must complete a sale in **≤ 3 taps** and **≤ 2 s** on a mid-range Android device.
This is a measured acceptance criterion, not a hope.

### 3.4 Reports in v1

Sales by hour (peak analysis) · top-selling products · cashier shift totals · cash variance
per shift · stock consumed vs sold (shrinkage indicator).

### 3.5 Acceptance criteria — bar

- [ ] A sale completes in ≤ 3 taps from the POS home screen.
- [ ] Two cashiers can work the same branch with separate sessions and separate variances.
- [ ] Peak-hour load: 60 sales/hour for 2 hours on one device without degradation.
- [ ] Stock consumed vs sold discrepancy is visible per product.

### 3.6 Reserved (not built in v1)

Recipes/BOM (a cocktail consumes 30 ml gin + 1 lime), bottle-level inventory with partial
bottle accounting, keg tracking, happy-hour price schedules.
**Schema hook:** `products.kind = "product"` plus a future `recipe` table keyed on
`product_id`; `stock_movements` already supports a `component_movement` reference.

---

## 4. Restaurant

The most complex sector; deliberately the least complete in v1.

### 4.1 Domain model in v1

| Entity | Notes |
|---|---|
| `products` | Menu items (`kind = product`) and beverages |
| `categories` | Menu sections (Entrées, Plats, Desserts, Boissons) |
| `sales` | Counter sales only in v1 — no table/room management |

### 4.2 v1 workflows (honest scope)

1. Sell at the counter: pick items, pay, receipt.
2. If the restaurant uses a paper ticket system, v1 records the sale when paid.
3. Stock decrements for menu items **only if** they map 1:1 to a purchased item.

> v1 does **not** do table management, order routing, split bills, or kitchen tickets.
> A restaurant can run counter sales and inventory. It cannot run a full service floor.

### 4.3 Reports in v1

Menu-item sales · category mix · daily totals · stock usage.

### 4.4 Acceptance criteria — restaurant (v1 scope only)

- [ ] A counter sale with 12 lines completes without error and prints a clean receipt.
- [ ] Category mix report reconciles to daily totals.
- [ ] The UI never presents table/room/order features that do not exist.

### 4.5 Reserved (not built in v1)

Tables, rooms, order state machine (`sent → preparing → ready → served`), kitchen display,
split bills, tips, service charges, modifiers.
**Schema hook:** `orders` table distinct from `sales`, `order_items` with
`status` and `sent_at`; `sales.order_id` nullable. Not created in v1 — recorded here so the
model is not blocked later.

---

## 5. Hair salon

The sector where **services** matter more than goods, and where staff identity matters.

### 5.1 Domain model in v1

| Entity | Notes |
|---|---|
| `products` | `kind = service`, `unit = session` (braids, cut, colour, manicure) |
| `products` | `kind = product` for retail items (shampoo, oil) |
| `members` | Each stylist is a member with branch access |
| `sales` | Cashier records the service and the **staff member who performed it** |

### 5.2 v1 workflows

1. Client arrives → select service → select stylist → record sale.
2. Retail product added to the same ticket.
3. End of day: per-stylist totals are visible (not commission-calculated).

### 5.3 Reports in v1

Revenue by service · revenue by stylist · retail vs service split · daily totals.

### 5.4 Acceptance criteria — salon

- [ ] A service can be sold with zero stock impact (services never decrement stock).
- [ ] A sale can be attributed to a stylist, and a per-stylist revenue report is correct.
- [ ] Service and retail items can share one receipt.
- [ ] A stylist cannot see another stylist's revenue (permission-scoped report).

### 5.5 Reserved (not built in v1)

Appointments/booking, commission rules (percentage, tiered, per-product), client history with
service notes, no-show handling, chair/station assignment.
**Schema hook:** `sale_items.staff_member_id` exists from v1; `commission_rules` is a later
table. `customers.notes` is present.

---

## 6. Pharmacy

The highest-compliance sector. Two capabilities are non-negotiable for real use, and **both
are reserved for a later phase — which is why v1 cannot honestly call itself pharmacy-ready.**

### 6.1 Domain model in v1

| Entity | Notes |
|---|---|
| `products` | Medicines; `track_expiry = true`, `batch_required = true` |
| `branch_stock` | Quantity only — **no batch or expiry tracking in v1** |
| `sales` | Standard OTC sale |

### 6.2 v1 workflows (honest scope)

1. Receive stock (quantity only).
2. Sell OTC items.
3. View stock levels and movement history.

> **This is not enough to run a pharmacy.** Batch tracking, expiry dates, and prescription
> records are legal and safety requirements. v1 ships the flags and the extension points; it
> does not ship the functionality.

### 6.3 Acceptance criteria — pharmacy (v1 scope only)

- [ ] Products can be flagged `track_expiry` / `batch_required` without breaking the catalog.
- [ ] Selling an expiring or prescription item is **blocked** with an explicit message rather
      than silently allowed.
- [ ] No screen implies batch or expiry management exists.

### 6.4 Reserved (not built in v1) — required before pharmacy launch

Batch records (`batches(id, product_id, branch_id, batch_no, expiry_date, qty)`), FEFO
allocation on sale, expiry alerts, prescription capture (`prescriptions(id, customer_id,
prescriber, items)`), controlled-substance flags, recall handling.
**Schema hook:** `stock_movements.batch_id` nullable from v1; `sale_items.batch_id` nullable
from v1. These two nullable columns are the entire reservation.

---

## 7. Sector readiness matrix

| Sector | v1 usable? | Advertised as | Blocking gap |
|---|---|---|---|
| Retail boutique | ✅ yes | **Operational** | variants (not blocking) |
| Bar | ✅ yes | **Operational** | recipes (not blocking) |
| Hair salon | ✅ yes | **Operational** | appointments (not blocking) |
| Restaurant | ⚠️ partially | **Counter sales only** | table/order management |
| Pharmacy | ⚠️ partially | **Not pharmacy-ready** | batches, expiry, prescriptions |

This table is the single source of truth for what the product claims. It is updated only when
acceptance criteria are met with evidence, never on a schedule.

---

## 8. Cross-sector acceptance suite

Every sector's criteria above are additional to the core suite in `ARCHITECTURE.md` §14.1.
The core suite (T1–T10) runs on **every** sector's seed data set, because mixed currency,
offline sync and tenant isolation do not care what the shop sells.
