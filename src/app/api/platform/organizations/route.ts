import { handleApi } from "@/server/http";
import { listOrganizations } from "@/server/platform";

/**
 * GET /api/platform/organizations — every organization with a business
 * summary + subscription. Cross-tenant read → audited (`org_list`).
 * Operator-gated (fail-closed allowlist).
 */
export const GET = handleApi(async (req) => listOrganizations(req.headers));
