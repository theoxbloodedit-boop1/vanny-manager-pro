/**
 * ADR-0015 — tenant theming: set the organization's tone.
 *
 * `themeId` is an id from the STATIC catalog (src/themes/themes.ts); null =
 * neutral (current design). Validation is app-side (no SQL CHECK): the
 * catalog evolves in code, and an unknown value must fail CLOSED (400 here;
 * the render layer falls back to neutral, never a 500).
 *
 * Authorization: `org.settings.manage` via `authorize()` (owner per the
 * permission matrix). The UPDATE runs inside `withTenantDb`, so RLS scopes
 * it to the caller's own org — a cross-tenant write is impossible by
 * construction.
 */
import { eq } from "drizzle-orm";
import * as z from "zod";
import { withTenantDb } from "../db/tenant";
import { organizations } from "../db/schema/org";
import { isThemeId, type ThemeId } from "../themes/themes";
import { ApiError } from "./errors";
import { requireActiveOrg } from "./members";
import { authorize } from "./rbac/authorize";

const themeBody = z.object({
  themeId: z.union([z.string().min(1).max(64), z.null()]),
});

export async function setOrganizationTheme(
  headers: Headers,
  raw: unknown,
): Promise<{ themeId: ThemeId | null }> {
  const body = themeBody.parse(raw);
  if (body.themeId !== null && !isThemeId(body.themeId)) {
    throw new ApiError(
      400,
      "UNKNOWN_THEME",
      "Ce ton n'existe pas dans le catalogue.",
    );
  }
  const { userId, orgId } = await requireActiveOrg(headers);
  await withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "org.settings.manage" });
    await db
      .update(organizations)
      .set({ themeId: body.themeId })
      .where(eq(organizations.id, orgId));
  });
  return { themeId: body.themeId };
}
