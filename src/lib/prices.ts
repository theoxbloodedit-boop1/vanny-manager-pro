import { assertCurrency, type Currency } from "./money";

/**
 * Price resolution — CTO Decision 2 (revised).
 *
 * Selling prices live in `product_prices`, one row per (product, currency).
 * A product may be USD-only, CDF-only, or both.
 *
 * THE RULE: if the selected price list has no configured price for a product,
 * the sale is REJECTED. It is never converted, estimated or defaulted.
 */

export type PriceRow = {
  currency: string;
  amountMinor: number;
};

export class PriceMissingError extends Error {
  readonly code = "PRICE_MISSING" as const;
  readonly productId: string;
  readonly currency: Currency;

  constructor(productId: string, currency: Currency) {
    super(
      `No ${currency} price configured for product ${productId}. ` +
        `A sale on the ${currency} price list cannot include this product.`,
    );
    this.name = "PriceMissingError";
    this.productId = productId;
    this.currency = currency;
  }
}

/**
 * Resolve the unit price for a product on a given price list.
 * Throws `PriceMissingError` when the price list has no price for it.
 */
export function resolvePrice(
  productId: string,
  prices: readonly PriceRow[],
  currency: string,
): number {
  const cur = assertCurrency(currency);
  const row = prices.find((p) => p.currency === cur);
  if (!row) {
    throw new PriceMissingError(productId, cur);
  }
  if (!Number.isSafeInteger(row.amountMinor) || row.amountMinor < 0) {
    throw new Error(
      `Invalid price amount for product ${productId} in ${cur}: ${row.amountMinor}`,
    );
  }
  return row.amountMinor;
}

/**
 * Validate a whole basket up front, so a sale never fails halfway through.
 * Returns the first problem found, or null when the basket is sellable.
 */
export function findMissingPrice(
  lines: readonly { productId: string; prices: readonly PriceRow[] }[],
  currency: string,
): PriceMissingError | null {
  for (const line of lines) {
    try {
      resolvePrice(line.productId, line.prices, currency);
    } catch (err) {
      if (err instanceof PriceMissingError) return err;
      throw err;
    }
  }
  return null;
}
