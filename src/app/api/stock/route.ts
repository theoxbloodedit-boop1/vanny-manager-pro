import { handleApi } from "@/server/http";
import { listStock } from "@/server/inventory";

/** GET /api/stock?branchId= — stock position per branch (derived from the ledger). */
export const GET = handleApi(async (req) =>
  listStock(req.headers, new URL(req.url).searchParams),
);
