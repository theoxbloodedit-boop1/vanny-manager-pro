import { handleApi } from "@/server/http";
import { listMembers } from "@/server/members";

/** GET /api/members — list the active organization's members. */
export const GET = handleApi(async (req) => listMembers(req.headers));
