import { handleApi, readJson } from "@/server/http";
import { createCategory, listCategories } from "@/server/catalog";

/** GET /api/categories — list the org's categories. */
export const GET = handleApi(async (req) => listCategories(req.headers));

/** POST /api/categories — create a category. Body: { name }. */
export const POST = handleApi(async (req) =>
  createCategory(req.headers, await readJson(req)),
);
