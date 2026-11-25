import { handleApi, readJson } from "@/server/http";
import { runOnboarding } from "@/server/onboarding";

/**
 * POST /api/onboarding — create the caller's organization + first branch.
 * Body: { name, slug, sector, baseCurrency, timezone?, firstBranchName }.
 */
export const POST = handleApi(async (req) =>
  runOnboarding(req.headers, await readJson(req)),
);
