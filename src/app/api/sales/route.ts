import { handleApi, readJson } from "@/server/http";
import { createSale, listSales } from "@/server/sales";

/** GET /api/sales?branchId=&limit= — recent sales history. */
export const GET = handleApi(async (req) =>
  listSales(req.headers, new URL(req.url).searchParams),
);

/** POST /api/sales — record a sale. Body: { branchId, currency, paymentMethod, customer?, items[] }. */
export const POST = handleApi(async (req) =>
  createSale(req.headers, await readJson(req)),
);
