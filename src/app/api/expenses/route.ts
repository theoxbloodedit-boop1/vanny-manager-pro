import { handleApi, readJson } from "@/server/http";
import { createExpense, listExpenses } from "@/server/sections";

/** GET /api/expenses — dépenses du tenant. */
export const GET = handleApi(async (req) => listExpenses(req.headers));

/** POST /api/expenses — enregistrer une dépense. */
export const POST = handleApi(async (req) =>
  createExpense(req.headers, await readJson(req)),
);
