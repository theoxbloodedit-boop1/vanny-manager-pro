import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR-0004 / ADR-0018 §2 — the append-only ledgers are DOCUMENTS.
 *
 * This guard greps ALL feature code (server services + API routes) and fails
 * the build if anyone writes an UPDATE or DELETE against an append-only
 * ledger — `stock_movements` (stock) or `manual_approvals` (verification).
 * The database trigger is the last line of defense; this makes the rule
 * visible and loud at review time, before a migration ships.
 *
 * Corrections are NEW documents: a stock error is a new `adjustment` row; a
 * revoked approval is a new revocation — never an edit of history.
 */

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../");
const SCAN_DIRS = ["src/server", "src/app"];

/** Ledger identifiers, both the drizzle variable and the raw SQL name. */
const LEDGERS = [
  { var: "stockMovements", table: "stock_movements" },
  { var: "manualApprovals", table: "manual_approvals" },
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

/** Collect every feature-code file, excluding this test's own directory. */
function featureFiles(): string[] {
  const out: string[] = [];
  for (const d of SCAN_DIRS) {
    const abs = join(ROOT, d);
    for (const f of walk(abs)) out.push(f);
  }
  return out;
}

describe("append-only ledger guard (ADR-0004/0018)", () => {
  it("scans a non-trivial number of feature files", () => {
    const files = featureFiles();
    expect(files.length).toBeGreaterThan(10);
  });

  for (const ledger of LEDGERS) {
    it(`never UPDATE/DELETEs ${ledger.table} (drizzle ${ledger.var})`, () => {
      const offenders: string[] = [];
      for (const file of featureFiles()) {
        const src = readFileSync(file, "utf8");
        // drizzle ORM:  db.update(stockMovements) / db.delete(stockMovements)
        // Allow whitespace between the call and the identifier.
        const re = new RegExp(
          `\\.(update|delete)\\(\\s*${ledger.var}\\b`,
        );
        if (re.test(src)) offenders.push(relative(ROOT, file));
        // Raw SQL:  UPDATE stock_movements / DELETE FROM stock_movements
        const raw = new RegExp(
          `(UPDATE|DELETE\\s+FROM)\\s+${ledger.table}\\b`,
          "i",
        );
        if (raw.test(src)) offenders.push(`${relative(ROOT, file)} (raw SQL)`);
      }
      expect(
        offenders,
        `append-only ledger ${ledger.table} was mutated in: ${offenders.join(", ")}`,
      ).toHaveLength(0);
    });
  }
});
