import { describe, expect, it } from "vitest";
import { isUuidV7, uuidv7 } from "../../src/lib/uuid";

/**
 * UUIDv7 (RFC 9562) — the client/server identifier standard (ADR-0003).
 * Time-ordered, monotonic within a process, 74 bits of randomness.
 */
describe("uuidv7", () => {
  it("matches the canonical v7 shape (version 7, variant 8-b)", () => {
    for (let i = 0; i < 200; i++) {
      const id = uuidv7();
      expect(isUuidV7(id)).toBe(true);
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it("is not valid for other UUID versions or malformed strings", () => {
    expect(isUuidV7("123e4567-e89b-12d3-a456-426614174000")).toBe(false); // v1
    expect(isUuidV7("123e4567-e89b-42d3-a456-426614174000")).toBe(false); // v4
    expect(isUuidV7("not-a-uuid")).toBe(false);
    expect(isUuidV7("")).toBe(false);
    // correct shape but version 4 → rejected
    expect(isUuidV7("018f3a2b-1c2d-4e5f-8a6b-7c8d9e0f1a2b")).toBe(false);
    // correct version but bad variant nibble (7 instead of 8-b) → rejected
    expect(isUuidV7("018f3a2b-1c2d-7e5f-7a6b-7c8d9e0f1a2b")).toBe(false);
  });

  it("embeds a timestamp that grows over time (time-ordered)", () => {
    const a = uuidv7();
    const b = uuidv7();
    // The first 48 bits are the ms timestamp → lexicographic order of the
    // string prefix reflects time order at ms resolution.
    expect(a.slice(0, 8) <= b.slice(0, 8)).toBe(true);
  });

  it("is strictly monotonic within the same millisecond", () => {
    const t = Date.now();
    const ids = Array.from({ length: 500 }, () => uuidv7(t));
    for (let i = 1; i < ids.length; i++) {
      const prev = ids[i - 1]!;
      const cur = ids[i]!;
      expect(prev < cur, `regressed at ${i}`).toBe(true);
    }
    // And all share the same ms prefix.
    const prefix = new Set(ids.map((id) => id.slice(0, 8)));
    expect(prefix.size).toBe(1);
  });

  it("is unique across a large sample", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20000; i++) seen.add(uuidv7());
    expect(seen.size).toBe(20000);
  });

  it("resumes monotonicity when the clock steps back one tick", () => {
    const t = Date.now();
    const a = uuidv7(t);
    const b = uuidv7(t - 1); // clock went backwards by 1ms
    const c = uuidv7(t - 1);
    // After a step-back the generator treats it as a new (earlier) tick and
    // still returns fresh ids; subsequent ids at the same (earlier) ts
    // remain ordered among themselves.
    expect(b < c).toBe(true);
    expect(typeof a).toBe("string");
  });
});
