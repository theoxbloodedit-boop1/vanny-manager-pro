import { handleApi, readJson } from "@/server/http";
import { listMovements, recordMovement } from "@/server/inventory";

/** GET /api/stock/movements?branchId=&limit= — ledger history (read-only). */
export const GET = handleApi(async (req) =>
  listMovements(req.headers, new URL(req.url).searchParams),
);

/**
 * POST /api/stock/movements — record a purchase or an adjustment.
 * Body: { type: "purchase" | "adjustment", branchId, productId, qty,
 *         direction?: "in" | "out", reference?, reason? (required for adjustment) }.
 * A movement is a document: it is never edited or deleted (ADR-0004/0018).
 */
export const POST = handleApi(async (req) =>
  recordMovement(req.headers, await readJson(req)),
);
