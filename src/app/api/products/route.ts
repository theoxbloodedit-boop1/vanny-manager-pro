import { handleApi, readJson } from "@/server/http";
import { createProduct, listProducts } from "@/server/catalog";

/** GET /api/products?q= — active products, unaccent search on name/sku/barcode. */
export const GET = handleApi(async (req) =>
  listProducts(req.headers, new URL(req.url).searchParams),
);

/** POST /api/products — create a product with ≥ 1 price (USD and/or CDF). */
export const POST = handleApi(async (req) =>
  createProduct(req.headers, await readJson(req)),
);
