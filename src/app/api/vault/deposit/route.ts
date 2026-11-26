import { handleApi, readJson } from "@/server/http";
import { depositToVault } from "@/server/vault";

/** POST /api/vault/deposit — deposit money into the vault. */
export const POST = handleApi(async (req) =>
  depositToVault(req.headers, await readJson(req)),
);
