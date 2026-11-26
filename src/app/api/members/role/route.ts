import { handleApi, readJson } from "@/server/http";
import { changeMemberRole } from "@/server/members";

/**
 * POST /api/members/role — change a member's role.
 * Body: { memberId, role }.
 */
export const POST = handleApi(async (req) =>
  changeMemberRole(req.headers, await readJson(req)),
);
