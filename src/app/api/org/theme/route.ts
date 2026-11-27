import { handleApi, readJson } from "@/server/http";
import { setOrganizationTheme } from "@/server/theme";

/**
 * POST/PATCH /api/org/theme — ADR-0015: set the active org's tone.
 * Body: { themeId: string | null } (null = neutral). Owner only.
 *
 * Les deux méthodes sont acceptées : le helper client envoie POST,
 * PATCH est conservé pour la cohérence/robustesse.
 */
const handler = handleApi(async (req) =>
  setOrganizationTheme(req.headers, await readJson(req)),
);

export const POST = handler;
export const PATCH = handler;

