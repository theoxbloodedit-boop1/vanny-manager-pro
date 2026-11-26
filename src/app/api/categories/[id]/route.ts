import { handleApi, readJson } from "@/server/http";
import { deleteCategory, updateCategory } from "@/server/catalog";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/categories/[id] — update a category (name, sortOrder, icon,
 * color). Categories.manage only.
 */
export async function PATCH(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const handler = handleApi(async (r) =>
    updateCategory(r.headers, id, await readJson(r)),
  );
  return handler(req);
}

/**
 * DELETE /api/categories/[id] — delete a category. Products in it are kept
 * (category cleared to null). Categories.manage only.
 */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const handler = handleApi(async (r) => deleteCategory(r.headers, id));
  return handler(req);
}
