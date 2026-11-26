import { handleApi, readJson } from "@/server/http";
import { inviteMember, myInvitations } from "@/server/members";

/**
 * POST /api/invitations — invite a person.
 * Body: { email, role, branchIds: string[] }.
 */
export const POST = handleApi(async (req) =>
  inviteMember(req.headers, await readJson(req)),
);

/** GET /api/invitations — list invitations addressed to the signed-in user. */
export const GET = handleApi(async (req) => myInvitations(req.headers));
