import { describe, expect, it } from "vitest";
import {
  PriceMissingError,
  findMissingPrice,
  resolvePrice,
} from "@/lib/prices";
import { formatMinor, roundToStep, toMinor } from "@/lib/money";

describe("resolvePrice — normalized product_prices", () => {
  const usdOnly = [{ currency: "USD", amountMinor: 4500 }];
  const cdfOnly = [{ currency: "CDF", amountMinor: 5000 }];
  const both = [
    { currency: "USD", amountMinor: 2500 },
    { currency: "CDF", amountMinor: 7000 },
  ];

  it("resolves a USD price for a USD-only product", () => {
    expect(resolvePrice("p1", usdOnly, "USD")).toBe(4500);
  });

  it("resolves a CDF price for a CDF-only product", () => {
    expect(resolvePrice("p2", cdfOnly, "CDF")).toBe(5000);
  });

  it("resolves both currencies for a dual-priced product", () => {
    expect(resolvePrice("p3", both, "USD")).toBe(2500);
    expect(resolvePrice("p3", both, "CDF")).toBe(7000);
  });

  it("REJECTS a USD sale when only CDF is configured", () => {
    expect(() => resolvePrice("p2", cdfOnly, "USD")).toThrow(PriceMissingError);
  });

  it("REJECTS a CDF sale when only USD is configured", () => {
    expect(() => resolvePrice("p1", usdOnly, "CDF")).toThrow(PriceMissingError);
  });

  it("NEVER converts a missing price from the other currency", () => {
    // The whole point of the normalized model: 5000 CDF must not become
    // 5000/x USD by arithmetic. There is no rate here at all.
    try {
      resolvePrice("p2", cdfOnly, "USD");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PriceMissingError);
      expect((err as PriceMissingError).code).toBe("PRICE_MISSING");
    }
  });

  it("rejects an unsupported currency", () => {
    expect(() => resolvePrice("p1", usdOnly, "EUR")).toThrow(/Unsupported currency/);
  });

  it("rejects a negative or fractional price", () => {
    expect(() => resolvePrice("p1", [{ currency: "USD", amountMinor: -1 }], "USD")).toThrow(
      /Invalid price amount/,
    );
    expect(() =>
      resolvePrice("p1", [{ currency: "USD", amountMinor: 1.5 }], "USD"),
    ).toThrow(/Invalid price amount/);
  });
});

describe("findMissingPrice — basket pre-validation", () => {
  it("returns null when every line is priced on the list", () => {
    const result = findMissingPrice(
      [
        { productId: "a", prices: [{ currency: "USD", amountMinor: 100 }] },
        { productId: "b", prices: [{ currency: "USD", amountMinor: 200 }] },
      ],
      "USD",
    );
    expect(result).toBeNull();
  });

  it("reports the first line with no price on the list", () => {
    const result = findMissingPrice(
      [
        { productId: "a", prices: [{ currency: "USD", amountMinor: 100 }] },
        { productId: "b", prices: [{ currency: "CDF", amountMinor: 900 }] },
      ],
      "USD",
    );
    expect(result).toBeInstanceOf(PriceMissingError);
    expect(result?.productId).toBe("b");
  });
});

describe("money", () => {
  it("converts major to minor units per currency exponent", () => {
    expect(toMinor(5.5, "USD")).toBe(550);
    expect(toMinor(5000, "CDF")).toBe(5000); // CDF has no sub-unit
  });

  it("refuses amounts that are not representable", () => {
    expect(() => toMinor(0.1 + 0.2, "CDF")).toThrow(/not representable/);
  });

  it("rounds to a step for CDF change", () => {
    expect(roundToStep(1234, 100)).toBe(1200);
    expect(roundToStep(1250, 100)).toBe(1300); // half away from zero
    expect(roundToStep(-1234, 100)).toBe(-1200);
    expect(roundToStep(1234, 1)).toBe(1234);
  });

  it("rejects an invalid step", () => {
    expect(() => roundToStep(100, 0)).toThrow(/invalid step/);
  });

  it("formats with the right number of decimals", () => {
    expect(formatMinor(550, "USD")).toContain("5,50");
    expect(formatMinor(5000, "CDF")).toContain("5");
  });
});
