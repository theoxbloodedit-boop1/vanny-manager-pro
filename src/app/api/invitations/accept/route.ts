import { handleApi, readJson } from "@/server/http";
import { acceptInvitation } from "@/server/members";

/**
 * POST /api/invitations/accept — accept an invitation addressed to the
 * signed-in user's verified email. Body: { invitationId }.
 */
export const POST = handleApi(async (req) =>
  acceptInvitation(req.headers, await readJson(req)),
);
