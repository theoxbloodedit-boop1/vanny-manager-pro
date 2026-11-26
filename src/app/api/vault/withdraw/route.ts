import { handleApi, readJson } from "@/server/http";
import { withdrawFromVault } from "@/server/vault";

/** POST /api/vault/withdraw — withdraw money from the vault. */
export const POST = handleApi(async (req) =>
  withdrawFromVault(req.headers, await readJson(req)),
);
