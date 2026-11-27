import { handleApi, readJson } from "@/server/http";
import { createSale, listSales, salesTodayStats } from "@/server/sales";

/** GET /api/sales?branchId=&limit= — recent sales history. */
/** GET /api/sales?stats=today&branchId= — today's sales aggregate (count + total). */
export const GET = handleApi(async (req) => {
  const params = new URL(req.url).searchParams;
  if (params.get("stats") === "today") return salesTodayStats(req.headers, params);
  return listSales(req.headers, params);
});

/** POST /api/sales — record a sale. Body: { branchId, currency, paymentMethod, customer?, items[] }. */
export const POST = handleApi(async (req) =>
  createSale(req.headers, await readJson(req)),
);
