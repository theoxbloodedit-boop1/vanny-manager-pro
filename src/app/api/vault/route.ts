import { handleApi } from "@/server/http";
import { getVault } from "@/server/vault";

/** GET /api/vault — vault summary, obligations and recent movements. */
export const GET = handleApi(async (req) => getVault(req.headers));
