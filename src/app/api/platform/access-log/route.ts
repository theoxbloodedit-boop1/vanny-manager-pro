import { handleApi } from "@/server/http";
import { listAccessLog } from "@/server/platform";

/**
 * GET /api/platform/access-log — recent platform-access audit entries
 * (who read tenant data, when, what). Cross-tenant read → audited.
 * Operator-gated. This is the transparency surface for the Phase-6.2 gate.
 */
export const GET = handleApi(async (req) => {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  return listAccessLog(req.headers, limit);
});
