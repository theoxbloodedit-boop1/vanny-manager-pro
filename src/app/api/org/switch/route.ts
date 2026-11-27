import { handleApi, readJson } from "@/server/http";
import { getAuth } from "@/auth";
import { ApiError } from "@/server/errors";

/**
 * POST /api/org/switch — ADR-0022 multi-activité.
 *
 * An account belonging to several organizations switches the active one in
 * its session (Better Auth `setActiveOrganization`). The next /api/me reads
 * the new org. Fail-closed: the org must belong to the caller.
 */
export const POST = handleApi(async (req) => {
  const body = (await readJson(req)) as { organizationId?: string };
  const orgId = body.organizationId;
  if (!orgId || typeof orgId !== "string") {
    throw new ApiError(400, "VALIDATION", "organizationId requis.");
  }
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentification requise.");
  }

  // Verify membership before switching (fail-closed).
  const membership = await auth.api.listOrganizations({
    headers: req.headers,
  });
  const mine = (membership as { organizations?: Array<{ id: string }> })
    .organizations ?? [];
  if (!mine.some((o) => o.id === orgId)) {
    throw new ApiError(403, "FORBIDDEN", "Vous n'appartenez pas à cette activité.");
  }

  await auth.api.setActiveOrganization({
    headers: req.headers,
    body: { organizationId: orgId },
  });
  return { ok: true, organizationId: orgId };
});
