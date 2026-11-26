import { handleApi, readJson } from "@/server/http";
import { payObligation } from "@/server/vault";

/** POST /api/vault/pay — pay an obligation from the vault (partial or full). */
export const POST = handleApi(async (req) =>
  payObligation(req.headers, await readJson(req)),
);
