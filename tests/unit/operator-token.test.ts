import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  issueOperatorToken,
  verifyOperatorToken,
} from "../../src/lib/operator-token";

const SECRET = "test-operator-signing-secret-not-for-production-424242";
const NOW = Date.now();

/** Decode a token's payload (test helper). */
function payload(token: string): Record<string, unknown> {
  const p64 = token.split(".")[1]!;
  return JSON.parse(Buffer.from(p64, "base64url").toString("utf8"));
}

describe("operator token (HS256 + jti, CTO hardening)", () => {
  it("verifies a valid token and returns the operator's real sub + jti", () => {
    const token = issueOperatorToken(SECRET, "operator-001", { nowMs: NOW });
    const p = payload(token);
    expect(typeof p.jti).toBe("string");
    expect(p.jti).not.toBe("");
    expect(verifyOperatorToken(token, SECRET)).toEqual({
      sub: "operator-001",
      jti: p.jti as string,
    });
  });

  it("defaults to a 15-minute (900s) lifetime", () => {
    const token = issueOperatorToken(SECRET, "operator-001", { nowMs: NOW });
    const p = payload(token);
    expect((p.exp as number) - (p.iat as number)).toBe(900);
  });

  it("accepts an explicit shorter/longer TTL", () => {
    const t = issueOperatorToken(SECRET, "op", { ttlSeconds: 60, nowMs: NOW });
    const p = payload(t);
    expect((p.exp as number) - (p.iat as number)).toBe(60);
  });

  it("allows a caller-supplied jti (idempotent issuance)", () => {
    const token = issueOperatorToken(SECRET, "operator-001", {
      jti: "11111111-2222-3333-4444-555555555555",
      nowMs: NOW,
    });
    expect(payload(token).jti).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("rejects a token signed with a different secret (forged identity)", () => {
    const token = issueOperatorToken("OTHER_SECRET", "operator-001", {
      nowMs: NOW,
    });
    expect(() => verifyOperatorToken(token, SECRET)).toThrow(/signature/i);
  });

  it("rejects an expired token", () => {
    const expired = issueOperatorToken(SECRET, "operator-001", {
      ttlSeconds: -10,
      nowMs: NOW,
    });
    expect(() => verifyOperatorToken(expired, SECRET)).toThrow(/expired/i);
  });

  it("rejects a token that is not a platform-operator (wrong role)", () => {
    const token = issueOperatorToken(SECRET, "operator-001", {
      role: "cashier",
      nowMs: NOW,
    });
    expect(() => verifyOperatorToken(token, SECRET)).toThrow(/operator/i);
  });

  it("rejects a legacy token with NO jti (cannot be revoked)", () => {
    // Hand-craft a token with all claims EXCEPT jti.
    const now = Math.floor(NOW / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const noJti = Buffer.from(
      JSON.stringify({
        sub: "legacy",
        iss: "vanny-operator",
        role: "platform-operator",
        iat: now,
        exp: now + 900,
      }),
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET)
      .update(`${header}.${noJti}`)
      .digest("base64url");
    expect(() => verifyOperatorToken(`${header}.${noJti}.${sig}`, SECRET)).toThrow(
      /jti/i,
    );
  });

  it("rejects a malformed token (not three segments)", () => {
    expect(() => verifyOperatorToken("not-a-jwt", SECRET)).toThrow(
      /malformed/i,
    );
  });

  it("rejects a token whose header is not HS256 (alg-confusion guard)", () => {
    const h64 = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");
    const p64 = Buffer.from(
      JSON.stringify({
        sub: "evil",
        jti: "00000000-0000-0000-0000-000000000000",
        role: "platform-operator",
        exp: Math.floor(NOW / 1000) + 3600,
      }),
    ).toString("base64url");
    expect(() => verifyOperatorToken(`${h64}.${p64}.`, SECRET)).toThrow();
  });

  it("rejects an empty token or empty secret", () => {
    expect(() => verifyOperatorToken("", SECRET)).toThrow();
    const token = issueOperatorToken(SECRET, "operator-001", { nowMs: NOW });
    expect(() => verifyOperatorToken(token, "")).toThrow();
  });
});
