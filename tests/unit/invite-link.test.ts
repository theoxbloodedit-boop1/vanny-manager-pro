import { describe, expect, it } from "vitest";
import {
  buildInviteAppUrl,
  buildInviteMessage,
  buildWhatsAppUrl,
  digitsOnly,
  normalizeWaPhone,
} from "@/server/invite-link";

describe("digitsOnly", () => {
  it("strips spaces, dashes, dots, parens and a leading +", () => {
    expect(digitsOnly("+243 978 508 099")).toBe("243978508099");
    expect(digitsOnly("243-978-508-099")).toBe("243978508099");
    expect(digitsOnly("(+243) 978.508.099")).toBe("243978508099");
  });

  it("returns empty string when letters or symbols are present", () => {
    expect(digitsOnly("0978abcd099")).toBe("");
    expect(digitsOnly("0978/508/099")).toBe("");
    expect(digitsOnly("")).toBe("");
  });
});

describe("normalizeWaPhone", () => {
  it("keeps an explicit international number", () => {
    expect(normalizeWaPhone("+243978508099")).toBe("243978508099");
    expect(normalizeWaPhone("243978508099")).toBe("243978508099");
  });

  it("formats human-spaced international numbers", () => {
    expect(normalizeWaPhone("+243 978 508 099")).toBe("243978508099");
    expect(normalizeWaPhone("+243-978-508-099")).toBe("243978508099");
  });

  it("rewrites DRC local numbers (0 → 243)", () => {
    expect(normalizeWaPhone("0978508099")).toBe("243978508099");
    expect(normalizeWaPhone("0 978 508 099")).toBe("243978508099");
  });

  it("rewrites double-zero international prefix", () => {
    expect(normalizeWaPhone("00243978508099")).toBe("243978508099");
  });

  it("accepts other country codes untouched", () => {
    expect(normalizeWaPhone("+33 6 12 34 56 78")).toBe("33612345678");
  });

  it("rejects invalid input", () => {
    expect(normalizeWaPhone("")).toBeNull();
    expect(normalizeWaPhone("abc")).toBeNull();
    expect(normalizeWaPhone("123")).toBeNull(); // too short
    expect(normalizeWaPhone("1".repeat(16))).toBeNull(); // > 15 digits
    expect(normalizeWaPhone("0978 508 09")).toBeNull(); // 8 digits after 0
  });
});

describe("buildInviteAppUrl", () => {
  it("points at /auth with the email pre-filled", () => {
    expect(buildInviteAppUrl("https://app.example.cd", "a@b.cd")).toBe(
      "https://app.example.cd/auth?email=a%40b.cd",
    );
  });

  it("strips a trailing slash from the base", () => {
    expect(buildInviteAppUrl("https://app.example.cd/", "a@b.cd")).toBe(
      "https://app.example.cd/auth?email=a%40b.cd",
    );
  });
});

describe("buildInviteMessage", () => {
  it("mentions org, email and the link", () => {
    const msg = buildInviteMessage("Boutique", "a@b.cd", "https://x/auth?email=a%40b.cd");
    expect(msg).toContain("« Boutique »");
    expect(msg).toContain("a@b.cd");
    expect(msg).toContain("https://x/auth?email=a%40b.cd");
  });
});

describe("buildWhatsAppUrl", () => {
  it("uses wa.me with encoded text", () => {
    const url = buildWhatsAppUrl("243978508099", "Bonjour à toi !");
    expect(url).toBe(
      `https://wa.me/243978508099?text=${encodeURIComponent("Bonjour à toi !")}`,
    );
    expect(url.startsWith("https://wa.me/243978508099?text=")).toBe(true);
  });
});
