# ADR-0007 — Offline outbox, idempotent sync, and device registry

**Status:** ACCEPTED · **Date:** 2026-11-24 · **CTO Decision 1 & 5**

## Context

Offline is a **mandatory commercial launch requirement**. A cashier in Fungurume cannot stop
selling because the network dropped. But offline writes create the hardest correctness problem
in the product: duplicate sales, corrupted stock, and lost revenue.

## Decision

### Outbox pattern

Every offline mutation is written to a Dexie `outbox` row **before** it is applied locally:

```
{ opId: uuidv7, entity: "sale", id: uuidv7, payload, status: "pending", attempts, nextAttemptAt }
```

Applied optimistically to the local projection, retried with exponential backoff, never
discarded until the server acknowledges.

### Idempotent server

`POST /api/sync/push` receives a batch. Each op is processed inside a transaction that first
checks `sync_operations(operation_id)`:

| Outcome | Meaning | Client action |
|---|---|---|
| `applied` | first time seen | mark synced |
| `duplicate` | already processed | mark synced, **drop** |
| `rejected` | business rule refused | mark rejected, surface to user |
| `conflict` | needs merge | run resolver, requeue |

`UNIQUE (operation_id)` makes this safe under concurrent retries. Sending the same op five
times produces one row — test T8.

### Delta pull

`GET /api/sync/pull?cursor=<iso>&scope=branch:<id>` returns `{ cursor, changes, deleted }`.
Scoped to the member's **branches**, never the whole organization. A cashier's device must not
hold another branch's stock figures.

### Device registry — CTO Decision 5

`devices(id, org_id, branch_id, member_id, label, platform, last_seen_at, revoked_at, …)`.

- Sync authenticates **device + member**, not member alone.
- Revocation is immediate: next push/pull returns `401 DEVICE_REVOKED`.
- On that response the client **wipes local tenant data** (`Dexie.delete()`), destroying the
  outbox. This is intentional: a lost phone must not retain tenant data.
- `operation_id` is unique **per device**, so two devices cannot collide.

### Conflict policy

| Entity | Policy |
|---|---|
| sales / payments / expenses / stock_movements | append-only — cannot conflict |
| customers | merge on normalized phone; server returns canonical id, client remaps |
| products | server-wins |
| cash_sessions | server-wins on close |

### Simultaneous offline sales

Neither device writes `branch_stock`. Both emit `stock_movements` referencing their sale. The
server recomputes stock from movements in arrival order. If the combined result is negative,
the sale still lands (money already changed hands) and a `STOCK_NEGATIVE` exception is raised
for the manager — **negative stock is visible, never silently clamped.**

## Consequences

- **+** Exactly-once effects for money and stock.
- **+** A revoked device is a dead device, immediately.
- **−** Significant client complexity: queue, backoff, resolvers, UI states.
- **−** Full offline cannot be claimed until the §6.7 real-device test passes.

## Launch gate

`ARCHITECTURE.md` §6.7 — eight steps on physical Android hardware, recorded with evidence.
Until it passes, offline is described as **in development**, never production-ready.
