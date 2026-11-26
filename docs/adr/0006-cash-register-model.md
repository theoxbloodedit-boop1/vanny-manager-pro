# ADR-0006 — Cash model: register ≠ cashier ≠ currency ≠ session

**Status:** ACCEPTED · **Date:** 2026-11-24 · **Revised:** 2026-11-24 (CTO final review)
**Supersedes:** the earlier "one session per branch per currency" design, which conflated a
branch with a physical drawer.

## Context

A busy branch has several tills. Each till holds two piles of cash — dollars and francs —
and several cashiers work it across a day. The earlier model keyed sessions on
`(branch, currency, cashier)`, which is wrong in three ways:

1. It assumes one drawer per branch. A bar with two tills cannot be represented.
2. It lets a cashier appear to work a register that does not exist.
3. It cannot express a handover between two cashiers on the same drawer.

## Decision

Four distinct concepts, four distinct representations.

| Concept | Representation | Notes |
|---|---|---|
| **Physical register** | `cash_registers(id, org_id, branch_id, name, code)` | Hardware. Many per branch. |
| **Cashier** | `cash_sessions.cashier_member_id` | A person. Never a register. |
| **Currency** | `cash_sessions.currency` | USD and CDF are **separate balances**, not a total. |
| **Cash session** | `cash_sessions(...)` | One cashier, one register, one currency, one period. |

### The invariant

```sql
CREATE UNIQUE INDEX cash_session_open_uq
  ON cash_sessions (register_id, currency)
  WHERE status = 'open';
```

**At most one open session per physical register per currency.** Enforced by Postgres, not by
application code — a second open session is rejected at the database level, so a race between
two devices cannot produce two open drawers.

### Handover procedure

When cashier B takes over register C1 / USD from cashier A:

1. A counts the drawer and closes their session — `counted`, `expected`, `variance` written.
2. B opens a new session with `handover_from_session_id = A's session` and
   `opening_float_minor = A's counted`.
3. Steps 1 and 2 run in **one transaction**. A half-completed handover is impossible.
4. The chain is auditable: every session names its predecessor.

Shift change is precisely when money goes missing, so the chain must be reconstructable.

## Consequences

- **+** Multiple tills per branch are representable.
- **+** USD and CDF are counted separately, so a 3,000 CDF shortfall cannot hide inside a
  blended total.
- **+** Handovers are first-class and auditable.
- **+** The open-session invariant is database-enforced, race-free.
- **−** A cashier closing a shift must close **two** sessions (USD and CDF). Mitigated by a
  single "close day" screen that submits both in one transaction.
- **−** `cash_registers` is a new table to administer. Branch setup must create registers
  before sessions can be opened.

## Rules

1. Never merge USD and CDF into a single "cash total".
2. `variance = counted − expected`, always computed, never typed.
3. `expected = opening_float + takings − refunds`, computed from `payments`.
4. A closed session is immutable. Correction requires a manager note on the next session.
5. A register with an open session cannot be deactivated.

## Verification

- Integration test: opening a second session on the same `(register, currency)` fails.
- Integration test: a handover writes both sessions atomically.
- Cash close reconciliation test, per currency (T1).
