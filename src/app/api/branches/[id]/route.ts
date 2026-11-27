import { handleApi } from "@/server/http";
import { deleteBranch } from "@/server/members";

/**
 * DELETE /api/branches/[id] — delete a branch (shop) permanently.
 * The branch id is taken from the URL path.
 */
export const DELETE = handleApi(async (req) => {
  const id = new URL(req.url).pathname.split("/").pop();
  return deleteBranch(req.headers, { id });
});
