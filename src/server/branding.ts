/**
 * ADR-0020 — TENANT BRANDING service layer.
 *
 * Lets an owner personalise their space beyond the static theme catalog:
 *   - brandName  : display name shown in the tenant header / login
 *                  (NULL → falls back to the org name).
 *   - logoUrl    : data URL (base64) of the tenant logo (NULL → VANNY mark).
 *   - brandColor : hex accent override (#RRGGBB) (NULL → theme accent).
 *
 * All three are validated app-side and fail-closed:
 *   - brandColor must be a valid #RRGGBB (or null).
 *   - logoUrl must be a data: URL of an image, under a size cap, and the
 *     decoded bytes must pass a magic-byte image sniff (no arbitrary file
 *     upload). Rejected with 400 otherwise.
 *
 * Authorization: `org.settings.manage` via `authorize()` (owner). The UPDATE
 * runs inside `withTenantDb`, so RLS scopes it to the caller's own org — a
 * cross-tenant write is impossible by construction.
 */
import { eq } from "drizzle-orm";
import * as z from "zod";
import { withTenantDb } from "../db/tenant";
import { organizations } from "../db/schema/org";
import { ApiError } from "./errors";
import { requireActiveOrg } from "./members";
import { authorize } from "./rbac/authorize";

/** Max logo size: 1.5 MB (data URL). Keeps the DB row + render cheap. */
const MAX_LOGO_BYTES = 1_500_000;

/** Hex color: #RGB or #RRGGBB. */
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const brandingBody = z.object({
  brandName: z.string().min(1).max(120).optional(),
  logoUrl: z.string().max(4_000_000).nullable().optional(),
  brandColor: z.string().max(16).nullable().optional(),
});

export interface Branding {
  brandName: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  themeId: string | null;
}

/** Read the org's branding (brand name / logo / accent + theme). */
export async function getOrgBranding(headers: Headers): Promise<Branding> {
  const { orgId } = await requireActiveOrg(headers);
  const rows = await withTenantDb(orgId, (db) =>
    db
      .select({
        brandName: organizations.brandName,
        logoUrl: organizations.logoUrl,
        brandColor: organizations.brandColor,
        themeId: organizations.themeId,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1),
  );
  const row = rows[0];
  return {
    brandName: row?.brandName ?? null,
    logoUrl: row?.logoUrl ?? null,
    brandColor: row?.brandColor ?? null,
    themeId: row?.themeId ?? null,
  };
}

/**
 * Validate a logo data URL: must be a data: URL, an image MIME, under the
 * size cap, and pass a magic-byte sniff. Returns the normalized data URL.
 */
function validateLogo(logoUrl: string | null | undefined): string | null {
  if (logoUrl === null || logoUrl === undefined) return null;
  const trimmed = logoUrl.trim();
  if (!trimmed) return null;

  const match = /^data:([^;,]+);base64,(.*)$/s.exec(trimmed);
  if (!match) {
    throw new ApiError(
      400,
      "INVALID_LOGO",
      "Le logo doit être une image (data URL).",
    );
  }
  const mime = match[1]!.toLowerCase();
  const b64 = match[2]!;
  if (!/^image\//.test(mime)) {
    throw new ApiError(
      400,
      "INVALID_LOGO",
      "Le logo doit être une image (jpg, png, webp, svg).",
    );
  }

  // Size cap on the decoded bytes.
  let bytes: Buffer;
  try {
    bytes = Buffer.from(b64, "base64");
  } catch {
    throw new ApiError(400, "INVALID_LOGO", "Logo mal formaté.");
  }
  if (bytes.length > MAX_LOGO_BYTES) {
    throw new ApiError(
      400,
      "LOGO_TOO_LARGE",
      `Logo trop lourd (max ${Math.round(MAX_LOGO_BYTES / 1000)} KB).`,
    );
  }
  if (bytes.length === 0) {
    throw new ApiError(400, "INVALID_LOGO", "Logo vide.");
  }

  // Magic-byte sniff: only accept common raster/vector image formats.
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp =
    bytes.slice(0, 4).toString("ascii") === "RIFF" &&
    bytes.slice(8, 12).toString("ascii") === "WEBP";
  const isSvg = /^\s*<svg/i.test(bytes.toString("utf8").slice(0, 200));
  if (!(isPng || isJpg || isWebp || isSvg)) {
    throw new ApiError(
      400,
      "INVALID_LOGO",
      "Format d'image non supporté (png, jpg, webp, svg).",
    );
  }
  return `data:${mime};base64,${b64}`;
}

/**
 * Update the org's branding. All provided fields are validated then written
 * in a single tenant-scoped UPDATE. Unknown/absent fields are left untouched.
 */
export async function setOrgBranding(
  headers: Headers,
  raw: unknown,
): Promise<Branding> {
  const body = brandingBody.parse(raw);

  // Validate color (fail-closed).
  let color: string | null | undefined;
  if (body.brandColor !== undefined) {
    const raw = body.brandColor;
    const c = raw === null ? "" : raw.trim();
    if (c === "") color = null;
    else if (HEX_COLOR_RE.test(c)) color = c.toLowerCase();
    else {
      throw new ApiError(
        400,
        "INVALID_COLOR",
        "Couleur invalide (format #RRGGBB).",
      );
    }
  }

  // Validate logo (fail-closed).
  const logo = validateLogo(body.logoUrl);

  const { userId, orgId } = await requireActiveOrg(headers);
  await withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "org.settings.manage" });
    const patch: Record<string, unknown> = {};
    if (body.brandName !== undefined) patch.brandName = body.brandName.trim();
    if (body.logoUrl !== undefined) patch.logoUrl = logo;
    if (body.brandColor !== undefined) patch.brandColor = color;
    await db
      .update(organizations)
      .set(patch)
      .where(eq(organizations.id, orgId));
  });

  return getOrgBranding(headers);
}
