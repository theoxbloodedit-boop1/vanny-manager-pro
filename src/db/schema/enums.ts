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
