import { describe, expect, it } from "vitest";
import { resolveBaseURL, resolveTrustedOrigins } from "../../src/auth/base-url";

/**
 * ADR-0016 hotfix — base URL resolution. On Vercel the deployment's own
 * runtime URL (VERCEL_URL) must win, so the origin check matches the URL the
 * browser is actually using, on every deployment, without env maintenance.
 */

describe("resolveBaseURL", () => {
  it("prefers VERCEL_URL (Vercel runtime, any deployment)", () => {
    expect(
      resolveBaseURL({
        VERCEL_URL: "vanny-manager-abc123-theoxbloodedit-7035.vercel.app",
        BETTER_AUTH_URL: "https://stale.example.com",
      }),
    ).toBe("https://vanny-manager-abc123-theoxbloodedit-7035.vercel.app");
  });

  it("falls back to BETTER_AUTH_URL outside Vercel (self-hosted)", () => {
    expect(
      resolveBaseURL({ BETTER_AUTH_URL: "https://vanny.internal" }),
    ).toBe("https://vanny.internal");
  });

  it("defaults to localhost for local development", () => {
    expect(resolveBaseURL({})).toBe("http://localhost:3000");
  });

  it("ignores blank values", () => {
    expect(resolveBaseURL({ VERCEL_URL: "  " })).toBe("http://localhost:3000");
    expect(
      resolveBaseURL({ VERCEL_URL: "", BETTER_AUTH_URL: "   " }),
    ).toBe("http://localhost:3000");
  });
});

describe("resolveTrustedOrigins (ADR-0012 follow-up — production alias domain)", () => {
  it("trusts the deployment URL (VERCEL_URL) on Vercel", () => {
    expect(
      resolveTrustedOrigins({
        VERCEL_URL: "vanny-manager-abc123-theoxbloodedit-7035.vercel.app",
      }),
    ).toEqual(["https://vanny-manager-abc123-theoxbloodedit-7035.vercel.app"]);
  });

  it("ADDS the stable production alias domain (APP_PRODUCTION_URL)", () => {
    const origins = resolveTrustedOrigins({
      VERCEL_URL: "vanny-manager-abc123-theoxbloodedit-7035.vercel.app",
      APP_PRODUCTION_URL: "https://vanny-manager-pro.vercel.app",
    });
    // Both the deployment origin AND the production domain must be trusted —
    // this is the exact bug: sign-in from the alias domain used to 403.
    expect(origins).toContain("https://vanny-manager-abc123-theoxbloodedit-7035.vercel.app");
    expect(origins).toContain("https://vanny-manager-pro.vercel.app");
  });

  it("includes BETTER_AUTH_URL for self-hosted deployments", () => {
    expect(
      resolveTrustedOrigins({ BETTER_AUTH_URL: "https://vanny.internal/" }),
    ).toEqual(["https://vanny.internal"]);
  });

  it("dedupes identical origins", () => {
    const origins = resolveTrustedOrigins({
      BETTER_AUTH_URL: "https://vanny-manager-pro.vercel.app",
      APP_PRODUCTION_URL: "https://vanny-manager-pro.vercel.app",
    });
    expect(origins).toEqual(["https://vanny-manager-pro.vercel.app"]);
  });

  it("returns an empty list when nothing is configured (keep default)", () => {
    expect(resolveTrustedOrigins({})).toEqual([]);
  });
});
