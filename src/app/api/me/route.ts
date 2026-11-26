import { handleApi } from "@/server/http";
import { getMe } from "@/server/me";

/** GET /api/me — current user, active organization, role. */
export const GET = handleApi(async (req) => getMe(req.headers));
