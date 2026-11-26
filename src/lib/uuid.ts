import { randomFillSync } from "node:crypto";

/**
 * UUIDv7 generator (RFC 9562) — no dependency, server-side only.
 *
 * Why v7: time-ordered ids keep indexes and WAL writes sequential, and the
 * timestamp prefix gives offline sync a natural ordering signal (ADR-0003).
 *
 * Bit layout (128 bits):
 *   48 ms since epoch | 4 version (0111) | 12 rand_a | 2 variant (10) | 62 rand_b
 *
 * Monotonicity: within one process, two ids in the same millisecond bump the
 * 74-bit random tail by one, so ids never regress. Cross-process ordering is
 * not guaranteed — v7 is a *signal* for sync, not a global sequence.
 */

const TAIL_BITS = 12n + 62n;
const TAIL_MASK = (1n << TAIL_BITS) - 1n;

let lastTimestamp = 0;
let lastTail = 0n;

function randomTail(): bigint {
  const bytes = new Uint8Array(10); // 80 bits, we keep 74
  randomFillSync(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v & TAIL_MASK;
}

function format(ts: number, tail: bigint): string {
  const ms = ts.toString(16).padStart(12, "0");
  const randA = ((tail >> 62n) & 0xfffn).toString(16).padStart(3, "0");
  // rand_b is 62 bits: its TOP TWO bits live in the variant hex digit
  // (10xx per RFC 9562 §5.7) and its low 60 bits fill the final 15 hex
  // chars. Emitting all 62 bits after a fixed "8" would overflow the 32-char
  // layout 25% of the time (bit 60 or 61 set) and silently drop a nibble.
  const randB = tail & ((1n << 62n) - 1n);
  const variantDigit = (0b1000 | Number((randB >> 60n) & 0b11n)).toString(16);
  const randBLow = (randB & ((1n << 60n) - 1n)).toString(16).padStart(15, "0");
  const s = `${ms}7${randA}${variantDigit}${randBLow}`; // exactly 32 chars
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

export function uuidv7(now: number = Date.now()): string {
  if (now === lastTimestamp) {
    const bumped = (lastTail + 1n) & TAIL_MASK;
    if (bumped !== 0n) {
      lastTail = bumped;
      return format(now, bumped);
    }
    // 2^74 collisions in one millisecond — impossible; fall through to a fresh
    // random tail (documented as a non-goal, not a supported case).
    lastTail = randomTail();
    return format(now, lastTail);
  }
  lastTimestamp = now;
  lastTail = randomTail();
  return format(now, lastTail);
}

export const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV7(s: string): boolean {
  return UUID_V7_RE.test(s);
}
