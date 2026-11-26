/**
 * Money helpers — the ONLY place allowed to do arithmetic on amounts.
 *
 * Rules (ADR-0005):
 *  - all amounts are integer minor units held in `bigint` columns
 *  - every amount carries an explicit currency
 *  - no floats, no `Math.round` on money anywhere else
 */

export const CURRENCY_EXPONENTS = {
  /** US dollar — 100 cents. */
  USD: 2,
  /** Congolese franc — no sub-unit in practice. */
  CDF: 0,
} as const;

export const CURRENCIES = ["USD", "CDF"] as const;

export type Currency = keyof typeof CURRENCY_EXPONENTS;

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

export function assertCurrency(value: string): Currency {
  if (!isCurrency(value)) {
    throw new Error(`Unsupported currency: "${value}". Expected one of ${CURRENCIES.join(", ")}.`);
  }
  return value;
}

/** Minor units per major unit for a currency. */
export function minorUnit(currency: Currency): number {
  return 10 ** CURRENCY_EXPONENTS[currency];
}

/** 5.5 USD → 550. Throws on non-representable input. */
export function toMinor(amount: number, currency: Currency): number {
  const factor = minorUnit(currency);
  const minor = amount * factor;
  if (!Number.isSafeInteger(minor)) {
    throw new Error(
      `Amount ${amount} ${currency} is not representable in minor units (got ${minor}).`,
    );
  }
  return minor;
}

/** 550 → 5.5. Only for display; never for arithmetic. */
export function fromMinor(minor: number, currency: Currency): number {
  return minor / minorUnit(currency);
}

/**
 * Round minor units to the nearest multiple of `stepMinor`.
 * Used for CDF change, where merchants round to 50 or 100 francs.
 * Ties round half away from zero, which is what a cashier does with coins.
 */
export function roundToStep(minor: number, stepMinor: number): number {
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`roundToStep received a non-integer amount: ${minor}`);
  }
  if (!Number.isSafeInteger(stepMinor) || stepMinor <= 0) {
    throw new Error(`roundToStep received an invalid step: ${stepMinor}`);
  }
  if (stepMinor === 1) return minor;
  const sign = minor < 0 ? -1 : 1;
  const abs = Math.abs(minor);
  return sign * Math.round(abs / stepMinor) * stepMinor;
}

/** Locale-aware display. French (DRC) by default. */
export function formatMinor(
  minor: number,
  currency: Currency,
  locale = "fr-CD",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    // Both bounds must equal the exponent: USD 5.50 must render "5,50",
    // not "5,5". CDF's exponent is 0, so francs render without decimals.
    minimumFractionDigits: CURRENCY_EXPONENTS[currency],
    maximumFractionDigits: CURRENCY_EXPONENTS[currency],
  }).format(fromMinor(minor, currency));
}
