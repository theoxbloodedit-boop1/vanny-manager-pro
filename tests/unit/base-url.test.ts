import { describe, expect, it } from "vitest";
import { resolveBaseURL } from "../../src/auth/base-url";

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
