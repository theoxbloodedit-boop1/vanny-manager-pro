import { handleApi, readJson } from "@/server/http";
import { createSupplier, listSuppliers } from "@/server/sections";

/** GET /api/suppliers — fournisseurs du tenant. */
export const GET = handleApi(async (req) => listSuppliers(req.headers));

/** POST /api/suppliers — enregistrer un fournisseur. */
export const POST = handleApi(async (req) =>
  createSupplier(req.headers, await readJson(req)),
);
