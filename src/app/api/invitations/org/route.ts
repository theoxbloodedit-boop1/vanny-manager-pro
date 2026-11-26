import { handleApi } from "@/server/http";
import { listOrgInvitations } from "@/server/members";

/** GET /api/invitations/org — pending invitations of the active org. */
export const GET = handleApi(async (req) => listOrgInvitations(req.headers));
