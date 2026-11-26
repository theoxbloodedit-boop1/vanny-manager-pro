# ADR-0005 — Normalized `product_prices` with per-currency rows

**Status:** ACCEPTED · **Date:** 2026-11-24 · **Revised:** 2026-11-24 (CTO final review)
**Supersedes:** the earlier "mandatory `price_usd_minor` / `price_cdf_minor` columns" design.

## Context

The DRC economy runs on two currencies at once. A shop prices a beer at 5,000 CDF and a phone
at $45 — and both numbers are commercial decisions the owner makes. Some products are only
ever sold in one currency.

Two earlier designs were rejected:

| Design | Why rejected |
|---|---|
| One canonical USD price, CDF derived at the till | A rate change silently reprices the shelf. The merchant never decided that. |
| Two mandatory `NOT NULL` price columns on `products` | Forces a merchant to invent a price in a currency they never use, or store a placeholder that will be sold by mistake. |

## Decision

Selling prices live in a **normalized table**:

```ts
product_prices (
  product_id  uuid    NOT NULL REFERENCES products(id),
  currency    enum    NOT NULL,        -- USD | CDF
  amount_minor bigint NOT NULL,        -- exact, integer minor units
  updated_by  text,
  updated_at  timestamptz,
  PRIMARY KEY (product_id, currency)
)
```

| Requirement | How it is met |
|---|---|
| Product ID | `product_id` |
| Currency code | `currency` (PG enum) |
| Exact monetary amount | `amount_minor bigint` — never a float |
| Unique product/currency pair | composite primary key |
| USD-only products | one row, `currency = 'USD'` |
| CDF-only products | one row, `currency = 'CDF'` |
| Both prices | two rows |
| Never silently convert | enforced in `src/lib/prices.ts` |

### The rejection rule

A sale carries a `pricing_currency` — the price list it is drawn from. **If a line's product
has no `product_prices` row for that currency, the sale is rejected with `PRICE_MISSING`.**
It is never converted, estimated, defaulted or zero-filled.

`findMissingPrice()` validates the whole basket before any write, so a sale never fails
halfway through.

### What the exchange rate is still for

Three jobs, and no more:

1. Settle change when tender currency and price-list currency differ.
2. Consolidate a mixed-currency report — always showing the rate used.
3. An *optional, one-time* suggestion when a merchant is entering a product
   ("suggest CDF from USD at today's rate") — stored as an independent number, never a
   live formula.

**Never silently revalued:** changing the rate never touches an existing sale.
`sales.fx_rate_usd_to_cdf` is a snapshot. Regression test T7.

## Consequences

- **+** A merchant prices only what they actually sell. No placeholders, no invented numbers.
- **+** Adding a currency later is a new enum value and new rows — no table rewrite.
- **+** The rejection is explicit and testable (`PRICE_MISSING`), not a silent conversion.
- **−** Price lookups are a join, not a column read. Indexed by primary key; negligible.
- **−** The catalog UI must show which currencies are priced per product, or a cashier will
  discover a missing price at the till. Mitigated by a "missing price" filter and a
  pre-sale basket check.
- **−** Product creation must validate that at least one price row exists.

## Rules

1. `amount_minor` is `bigint`. No floats, no `numeric` without a declared scale.
2. `src/lib/money.ts` owns the exponent table (`USD: 2`, `CDF: 0`) and all rounding.
   `Math.round` on money anywhere else fails review.
3. Both a USD and a CDF price are **optional** — but at least one must exist.
4. `pricing_currency` is set once per sale and cannot change mid-basket.
5. Reports never sum raw CDF and raw USD. Consolidation requires an explicit conversion row.

## Verification

`tests/unit/prices.test.ts` covers: USD-only, CDF-only, dual, rejection both directions,
and an explicit test that a missing price is **never** derived from the other currency.
