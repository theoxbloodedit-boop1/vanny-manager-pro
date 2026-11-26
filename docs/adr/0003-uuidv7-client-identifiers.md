# ADR-0003 — Client-generated UUIDv7 identifiers

**Status:** ACCEPTED · **Date:** 2026-11-24

## Context

Cashiers must be able to record sales with no connectivity. A device that cannot name a row
cannot store it. Every identifier strategy was evaluated against the offline requirement:

| Strategy | Offline | Index locality | Leaks volume? |
|---|:--:|:--:|:--:|
| `serial` / auto-increment | ❌ impossible | ✅ | ✅ reveals daily sales volume |
| UUID v4 | ✅ | ❌ random, fragments indexes | no |
| Server-issued IDs | ❌ impossible | ✅ | no |
| **UUID v7** | ✅ | ✅ time-ordered | no |

## Decision

**All primary keys are UUID v7, generated on the client** at the moment the record is created.
The server never assigns identity for offline-capable entities.

## Consequences

- **+** A sale can exist on the device before the server knows about it. Offline becomes possible.
- **+** Time-ordered identifiers keep B-tree inserts append-only — good for Postgres and for
  Neon's storage.
- **+** No enumeration attack: a URL like `/sales/<uuid>` reveals nothing about volume.
- **−** IDs are 16 bytes, not 4. Acceptable.
- **−** `uuidv7` becomes a client dependency (`uuid` package v11+ supports v7).
- **−** Human-readable sale numbers are a **separate** field (`sales.number`), assigned
  server-side per organization, because receipts need them and they must be gap-free per org.

## Rules

1. Never `gen_random_uuid()` (v4) for entities that sync. Use `uuidv7()`.
2. `sales.number` is assigned server-side, unique per `org_id`, and is the only identifier
   shown to users.
3. No auto-increment column anywhere in the schema. Enforced by a schema-lint test.
