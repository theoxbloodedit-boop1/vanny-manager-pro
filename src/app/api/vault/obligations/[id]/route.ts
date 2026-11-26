import { handleApi } from "@/server/http";
import { deleteObligation, settleObligation } from "@/server/vault";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/vault/obligations/[id] — mark an obligation as fully paid.
 * vault.manage only.
 */
export async function PATCH(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const handler = handleApi(async (r) => settleObligation(r.headers, id));
  return handler(req);
}

/**
 * DELETE /api/vault/obligations/[id] — delete an obligation (unpaid only).
 * vault.manage only.
 */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const handler = handleApi(async (r) => deleteObligation(r.headers, id));
  return handler(req);
}
