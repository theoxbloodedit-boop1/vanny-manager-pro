import { describe, expect, it } from "vitest";
import {
  isVirtualEmail,
  PHONE_VIRTUAL_DOMAIN,
  normalizePhone,
  PhoneError,
  phoneToVirtualEmail,
} from "../../src/server/phone";

/**
 * ADR-0016 — phone normalization (E.164, DRC-centric) and the
 * phone → virtual-email mapping (deterministic identifier).
 */

describe("normalizePhone", () => {
  it("normalizes DRC local 0x numbers (spaces, dots, hyphens)", () => {
    expect(normalizePhone("097 123 4567")).toBe("+243971234567");
    expect(normalizePhone("097.123.4567")).toBe("+243971234567");
    expect(normalizePhone("097-123-4567")).toBe("+243971234567");
    expect(normalizePhone("0971234567")).toBe("+243971234567");
    expect(normalizePhone("0891234567")).toBe("+243891234567");
  });

  it("normalizes explicit + numbers for any country", () => {
    expect(normalizePhone("+243 971 234 567")).toBe("+243971234567");
    expect(normalizePhone("+243971234567")).toBe("+243971234567");
    expect(normalizePhone("+33 6 12 34 56 78")).toBe("+33612345678");
  });

  it("normalizes bare 243 numbers (international form without +)", () => {
    expect(normalizePhone("243971234567")).toBe("+243971234567");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizePhone("  0971234567  ")).toBe("+243971234567");
  });

  it("rejects empty / non-numeric / ambiguous input", () => {
    for (const bad of [
      "",
      "   ",
      "abc",
      "097123456a",
      "12345", // too short, ambiguous
      "971234567", // no 0 / 243 / + prefix → ambiguous
      "+",
      "09712345678901234567", // too long
    ]) {
      expect(() => normalizePhone(bad), bad).toThrow(PhoneError);
    }
  });
});

describe("phoneToVirtualEmail", () => {
  it("maps E.164 deterministically to the virtual domain", () => {
    expect(phoneToVirtualEmail("+243971234567")).toBe(
      `243971234567@${PHONE_VIRTUAL_DOMAIN}`,
    );
  });

  it("is stable across equivalent input forms", () => {
    const a = phoneToVirtualEmail(normalizePhone("097 123 4567"));
    const b = phoneToVirtualEmail(normalizePhone("+243971234567"));
    expect(a).toBe(b);
  });

  it("rejects non-E.164 input", () => {
    expect(() => phoneToVirtualEmail("0971234567")).toThrow(PhoneError);
  });
});

describe("isVirtualEmail", () => {
  it("recognizes the reserved domain (case-insensitive)", () => {
    expect(isVirtualEmail(`243971234567@${PHONE_VIRTUAL_DOMAIN}`)).toBe(true);
    expect(isVirtualEmail(`243971234567@${PHONE_VIRTUAL_DOMAIN.toUpperCase()}`)).toBe(
      true,
    );
    expect(isVirtualEmail("alice@example.com")).toBe(false);
    expect(isVirtualEmail("not-an-email")).toBe(false);
    expect(isVirtualEmail("evil@sub." + PHONE_VIRTUAL_DOMAIN + ".com")).toBe(false);
  });
});
