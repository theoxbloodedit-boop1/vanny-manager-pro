import { handleApi, readJson } from "@/server/http";
import { grantBranchAccess } from "@/server/members";

/**
 * POST /api/branches/access — grant a member access to a branch.
 * Body: { branchId, userId }.
 */
export const POST = handleApi(async (req) =>
  grantBranchAccess(req.headers, await readJson(req)),
);
