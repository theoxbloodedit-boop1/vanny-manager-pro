import { handleApi } from "@/server/http";
import { listBillingEvents } from "@/server/platform";

/**
 * GET /api/platform/billing-events — recent billing ledger entries across all
 * orgs (append-only). Cross-tenant read → audited. Operator-gated.
 */
export const GET = handleApi(async (req) => {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  return listBillingEvents(req.headers, limit);
});
