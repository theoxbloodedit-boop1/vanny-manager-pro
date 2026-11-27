import { handleApi, readJson } from "@/server/http";
import { listCustomers, saveCustomer } from "@/server/sales";

/** GET /api/customers?branchId= — list the active org's customers. */
export const GET = handleApi(async (req) =>
  listCustomers(req.headers, new URL(req.url).searchParams),
);

/** POST /api/customers — create/update a customer. Body: { branchId?, name, phone?, note? }. */
export const POST = handleApi(async (req) =>
  saveCustomer(req.headers, await readJson(req)),
);
