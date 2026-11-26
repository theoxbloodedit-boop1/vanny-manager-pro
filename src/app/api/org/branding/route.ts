import { handleApi, readJson } from "@/server/http";
import { getOrgBranding, setOrgBranding } from "@/server/branding";

/**
 * GET /api/org/branding — read the active org's branding (brand name, logo,
 * accent color, theme). Owner-relevant; any active member may read.
 */
export const GET = handleApi(async (req) => getOrgBranding(req.headers));

/**
 * PATCH /api/org/branding — ADR-0020: set the active org's branding
 * (brandName, logoUrl, brandColor). All fields validated + fail-closed.
 * Owner only (`org.settings.manage`).
 */
export const PATCH = handleApi(async (req) =>
  setOrgBranding(req.headers, await readJson(req)),
);
