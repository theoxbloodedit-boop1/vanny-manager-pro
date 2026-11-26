# ADR-0004 — Append-only financial and inventory ledgers

**Status:** ACCEPTED · **Date:** 2026-11-24

## Context

A sale is money that already changed hands. An expense is cash that already left the drawer.
Editing either record retroactively makes every historical report a lie and destroys the
audit trail. Traditional CRUD is the wrong model here.

## Decision

The following tables are **append-only**:

`sales`, `sale_items`, `payments`, `stock_movements`, `expenses`, `cash_sessions`,
`audit_log`, `fx_rate_history`, `sync_operations`.

They are never `UPDATE`d or `DELETE`d by application code. Corrections are **new documents
that reference the original**:

| Correction | Implemented as |
|---|---|
| Void a sale | `sales.status = "voided"` + a reversing document with `voids_sale_id` |
| Refund | a new `payments` row with negative amount, `refund_of_sale_id` |
| Stock error | a new `stock_movements` row of type `adjustment`, never an edit of quantity |
| Cash variance | recorded on the session; the session is not edited after close |

`branch_stock` is the single exception: it is a **materialised projection**, recomputed from
`stock_movements`, and is never the source of truth.

## Consequences

- **+** Full audit trail by construction — you can reconstruct any day's position.
- **+** Offline sync becomes tractable: append-only documents cannot conflict, they can only
  arrive twice (solved by `operation_id`, ADR-0007).
- **+** Historical reports are stable forever.
- **−** Typos require a reversing document, not an edit. This is correct but must be taught
  in the UI — the "edit" button on a completed sale must open a void/refund flow, not a form.
- **−** `UPDATE` grants are technically present on the runtime role. Enforced in code and by a
  CI test that greps feature code for `.update(` on ledger tables.

## Invariant

```
branch_stock(branch, product) == Σ stock_movements(branch, product).qty_delta
```

Tested after every mutation type (sale, void, refund, transfer, adjustment) — test T3.
