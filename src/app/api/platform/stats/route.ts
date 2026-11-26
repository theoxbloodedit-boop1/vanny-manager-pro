import { handleApi } from "@/server/http";
import { platformStats } from "@/server/platform";

/**
 * GET /api/platform/stats — platform-wide summary (orgs, members, branches,
 * products, plan distribution, 30-day revenue). Cross-tenant read → audited.
 * Operator-gated (fail-closed allowlist).
 */
export const GET = handleApi(async (req) => platformStats(req.headers));
