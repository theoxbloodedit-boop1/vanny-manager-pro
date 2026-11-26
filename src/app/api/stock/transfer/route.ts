import { handleApi, readJson } from "@/server/http";
import { transferStock } from "@/server/inventory";

/**
 * POST /api/stock/transfer — atomic inter-branch transfer (ADR-0018 D3).
 * Body: { fromBranchId, toBranchId, items: [{ productId, qty }], reference? }.
 * One transaction: both branches move together or neither does.
 */
export const POST = handleApi(async (req) =>
  transferStock(req.headers, await readJson(req)),
);
