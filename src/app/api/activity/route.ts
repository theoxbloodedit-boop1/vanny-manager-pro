import { handleApi, readJson } from "@/server/http";
import { listActivity, logActivity } from "@/server/sections";

/** GET /api/activity — journal d'activité du tenant. */
export const GET = handleApi(async (req) => listActivity(req.headers));

/** POST /api/activity — écrire une ligne (append-only). */
export const POST = handleApi(async (req) =>
  logActivity(req.headers, await readJson(req)),
);
