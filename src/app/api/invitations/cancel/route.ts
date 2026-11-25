import { handleApi, readJson } from "@/server/http";
import { cancelInvitation } from "@/server/members";

/**
 * POST /api/invitations/cancel — cancel a pending invitation.
 * Body: { invitationId }.
 */
export const POST = handleApi(async (req) =>
  cancelInvitation(req.headers, await readJson(req)),
);
