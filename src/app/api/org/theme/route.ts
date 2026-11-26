import { handleApi, readJson } from "@/server/http";
import { setOrganizationTheme } from "@/server/theme";

/**
 * PATCH /api/org/theme — ADR-0015: set the active org's tone.
 * Body: { themeId: string | null } (null = neutral). Owner only.
 */
export const PATCH = handleApi(async (req) =>
  setOrganizationTheme(req.headers, await readJson(req)),
);
