#!/usr/bin/env node
/**
 * PWA service-worker guard.
 *
 * Why this exists (ADR-0008):
 * `next build --turbopack` exits 0 while emitting NO service worker, because
 * @serwist/next does not support Turbopack. The build looks green, the PWA
 * ships with zero offline capability, and nobody notices until a cashier
 * loses a sale.
 *
 * This script makes that failure loud.
 */

import { statSync } from "node:fs";
import { resolve } from "node:path";

const SW_PATH = resolve(process.cwd(), "public", "sw.js");
const MIN_BYTES = 10_000;

let size;
try {
  size = statSync(SW_PATH).size;
} catch {
  console.error(
    "\n[pwa:guard] FAIL — public/sw.js was not generated.\n" +
      "             The build likely ran under Turbopack. Use `next build --webpack`.\n",
  );
  process.exit(1);
}

if (size < MIN_BYTES) {
  console.error(
    `\n[pwa:guard] FAIL — public/sw.js is only ${size} bytes (expected >= ${MIN_BYTES}).\n` +
      "             A stub service worker gives no offline capability.\n",
  );
  process.exit(1);
}

console.log(`[pwa:guard] OK — public/sw.js present (${size} bytes).`);
