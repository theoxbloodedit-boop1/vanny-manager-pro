import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Supported currencies. CDF has no sub-unit in practice (exponent 0);
 * USD has cents (exponent 2). See `src/lib/money.ts`.
 */
export const currencyEnum = pgEnum("currency", ["USD", "CDF"]);

/** The five business sectors. Extension points are documented in SECTORS.md. */
export const businessSectorEnum = pgEnum("business_sector", [
  "boutique",
  "bar",
  "restaurant",
  "salon",
  "pharmacy",
]);

/** `service` items never touch stock. */
export const productKindEnum = pgEnum("product_kind", ["product", "service"]);

/**
 * ADR-0004/0018 — stock movement types. The enum is frozen NOW (sale/return
 * included) so Phase 3 never has to migrate an append-only ledger. `sale` and
 * `return` are written by the POS (Phase 3) only.
 */
export const stockMovementTypeEnum = pgEnum("stock_movement_type", [
  "purchase",
  "adjustment",
  "transfer_in",
  "transfer_out",
  "sale",
  "return",
]);

export const saleStatusEnum = pgEnum("sale_status", [
  "completed",
  "voided",
  "refunded",
]);

/** A cash register is a physical drawer unit, not a person and not a currency. */
export const cashSessionStatusEnum = pgEnum("cash_session_status", [
  "open",
  "closed",
]);
