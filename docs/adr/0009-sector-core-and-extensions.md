# ADR-0009 — One operational core, sector extensions reserved

**Status:** ACCEPTED · **Date:** 2026-11-24 · **CTO Decision 3**

## Context

Five sectors — boutique, bar, restaurant, hair salon, pharmacy — share roughly 80% of their
operational behaviour: a catalog, stock, sales, cash, customers, expenses. The remaining 20%
diverges sharply (bar recipes, salon appointments, pharmacy batches).

Two strategies were possible:

| Strategy | Verdict |
|---|---|
| Five separate applications | Rejected — 5× the cost, no shared improvement, no unified platform |
| One core + sector extensions | **Accepted** |

## Decision

Ship **one operational core** to every sector. Store `org.business_sector` and use it for
copy, defaults and presets. Sector-specific behaviour is added later as **extensions**, never
as forks.

### Extension points reserved in the v1 schema

| Sector | Extension (later) | Hook reserved now |
|---|---|---|
| Boutique | variants, sizes, colours | `products.parent_product_id`, `variant_attributes jsonb` |
| Bar | recipes, bottle-level inventory | `stock_movements.component_movement_id` |
| Restaurant | tables, orders, kitchen | `sales.order_id` (nullable), future `orders` table |
| Salon | appointments, commissions | `sale_items.staff_member_id` |
| Pharmacy | batches, expiry, prescriptions | `stock_movements.batch_id`, `sale_items.batch_id` |

The nullable columns are cheap now and prevent a table rewrite later. **They are not
advertised in the UI until they do something.**

## Binding rule — no fake readiness

A sector is advertised as operational **only when its acceptance criteria in `SECTORS.md`
pass with evidence.** The readiness matrix in `SECTORS.md` §7 is the single source of truth.

Concretely, at v1:

| Sector | Claimed |
|---|---|
| Boutique | Operational |
| Bar | Operational |
| Hair salon | Operational |
| Restaurant | **Counter sales only** |
| Pharmacy | **Not pharmacy-ready** |

A restaurant using v1 must never see a "Tables" tab that goes nowhere. A pharmacy must never
see "Batches" that implies expiry tracking exists. **Absent features are absent, not disabled.**

## Consequences

- **+** One codebase, one test suite, one migration path.
- **+** Every sector benefits from every improvement.
- **+** Marketing claims stay honest, because the readiness matrix is enforced by review.
- **−** Restaurant and pharmacy are not complete in v1, and must be sold as such.
- **−** The common core must stay genuinely common — no `if (sector === "salon")` branches in
  the sales path. Sector divergence lives in extension modules, not in conditionals.
- **−** Reserved columns that stay unused for a long time are technical debt. Accepted, and
  tracked in the roadmap so they are either used or dropped by v2.

## Rule

Any sector-specific conditional in shared business logic requires an ADR amendment. The
default answer is "put it in the extension module".
