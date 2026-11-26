import { handleApi, readJson } from "@/server/http";
import { createObligation } from "@/server/vault";

/** POST /api/vault/obligations — create a payable (facture, loyer, ...). */
export const POST = handleApi(async (req) =>
  createObligation(req.headers, await readJson(req)),
);
