import { handleApi, readJson } from "@/server/http";
import { createBranch, listBranches, updateBranch } from "@/server/members";

/** GET /api/branches — list the active organization's branches. */
export const GET = handleApi(async (req) => listBranches(req.headers));

/** POST /api/branches — create a branch. Body: { name, address?, phone? }. */
export const POST = handleApi(async (req) =>
  createBranch(req.headers, await readJson(req)),
);

/** PATCH /api/branches — update a branch. Body: { id, name?, address?, phone?, isActive? }. */
export const PATCH = handleApi(async (req) =>
  updateBranch(req.headers, await readJson(req)),
);
