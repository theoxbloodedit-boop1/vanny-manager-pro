import { handleApi } from "@/server/http";
import { getOrgDetail } from "@/server/platform";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/platform/organizations/[id] — detailed business summary for one
 * organization (members, branches, product count, subscription, recent
 * billing). Cross-tenant read → audited (`org_detail`). Operator-gated.
 */
export async function GET(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const handler = handleApi(async (r) => getOrgDetail(r.headers, id));
  return handler(req);
}
