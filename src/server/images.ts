/**
 * ADR-0022 — shared image validation.
 *
 * Factored out of the branding service: any user-supplied image (logo,
 * product photo) goes through the same fail-closed validation — data URL,
 * image MIME, size cap, magic-byte sniff (png/jpg/webp/svg).
 */
import { ApiError } from "./errors";

/** Max image size: 1.5 MB (decoded bytes). */
export const MAX_IMAGE_BYTES = 1_500_000;

/**
 * Validate an image data URL. Returns the normalized data URL, or null for
 * null/empty input. Throws ApiError(400) on any invalid input (fail-closed).
 */
export function validateImageDataUrl(imageUrl: string | null | undefined): string | null {
  if (imageUrl === null || imageUrl === undefined) return null;
  const trimmed = imageUrl.trim();
  if (!trimmed) return null;

  const match = /^data:([^;,]+);base64,(.*)$/s.exec(trimmed);
  if (!match) {
    throw new ApiError(400, "INVALID_IMAGE", "L'image doit être un fichier image (data URL).");
  }
  const mime = match[1]!.toLowerCase();
  const b64 = match[2]!;
  if (!/^image\//.test(mime)) {
    throw new ApiError(400, "INVALID_IMAGE", "L'image doit être un fichier image (jpg, png, webp, svg).");
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(b64, "base64");
  } catch {
    throw new ApiError(400, "INVALID_IMAGE", "Image mal formatée.");
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ApiError(
      400,
      "IMAGE_TOO_LARGE",
      `Image trop lourde (max ${Math.round(MAX_IMAGE_BYTES / 1000)} KB).`,
    );
  }
  if (bytes.length === 0) {
    throw new ApiError(400, "INVALID_IMAGE", "Image vide.");
  }

  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp =
    bytes.slice(0, 4).toString("ascii") === "RIFF" &&
    bytes.slice(8, 12).toString("ascii") === "WEBP";
  const isSvg = /^\s*<svg/i.test(bytes.toString("utf8").slice(0, 200));
  if (!(isPng || isJpg || isWebp || isSvg)) {
    throw new ApiError(400, "INVALID_IMAGE", "Format d'image non supporté (png, jpg, webp, svg).");
  }
  return `data:${mime};base64,${b64}`;
}
