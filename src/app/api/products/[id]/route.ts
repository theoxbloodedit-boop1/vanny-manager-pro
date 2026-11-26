import { handleApi, readJson } from "@/server/http";
import { deleteProduct, updateProduct } from "@/server/catalog";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/products/[id] — update a product (name, prices, threshold…).
 * A price set to `null` is removed; the last remaining price cannot be.
 */
export async function PATCH(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const handler = handleApi(async (r) =>
    updateProduct(r.headers, id, await readJson(r)),
  );
  return handler(req);
}

/**
 * DELETE /api/products/[id] — 409 when the product has stock history
 * (ADR-0018 D8: deactivate instead).
 */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const handler = handleApi(async (r) => deleteProduct(r.headers, id));
  return handler(req);
}
