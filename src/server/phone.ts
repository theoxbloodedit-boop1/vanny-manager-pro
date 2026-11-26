/**
 * PHONE IDENTITY (ADR-0016) — normalization + virtual-email mapping.
 *
 * A phone account's Better Auth identifier is a DETERMINISTIC virtual email
 * derived from the E.164 number. The number itself is stored in
 * `user.phone`. The virtual domain is NEVER a delivery address (see
 * src/server/email.ts) and is rejected on the email sign-up path (see
 * src/app/api/auth/[...all]/route.ts).
 *
 * DRC-centric normalization (the product's primary market):
 *   "097 123 4567"   → +243971234567   (local 0x form, DRC trunk prefix)
 *   "+243 971 234 567" → +243971234567
 *   "243971234567"   → +243971234567   (international form without +)
 *   "+33 6 12 34 56 78" → +33612345678 (any country code is accepted when
 *                                  explicitly given with +)
 * Bare numbers WITHOUT a leading + are only accepted in the DRC forms
 * (0x… or 243…) — anything else is ambiguous and rejected.
 */

/** The reserved domain for phone-account virtual emails. */
export const PHONE_VIRTUAL_DOMAIN = "phone.vanny.app";

const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/** Throws a safe, user-facing French message for bad input. */
export class PhoneError extends Error {}

/** Normalize a user-typed phone number to E.164 (+CC digits). */
export function normalizePhone(input: string): string {
  const raw = (input ?? "").trim();
  if (raw.length === 0) {
    throw new PhoneError("Le numéro de téléphone est requis.");
  }
  // Allowed characters: digits, spaces, dots, hyphens, parens, leading +.
  if (!/^\+?[\d\s.()-]*$/.test(raw)) {
    throw new PhoneError(
      "Numéro invalide — chiffres uniquement (ex. 0971234567).",
    );
  }
  const s = raw.replace(/[\s.()-]/g, "");

  if (s.startsWith("+")) {
    const digits = s.slice(1);
    if (!/^\d+$/.test(digits)) {
      throw new PhoneError("Numéro invalide — chiffres uniquement.");
    }
    if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) {
      throw new PhoneError(
        "Numéro invalide — longueur incorrecte (ex. +243971234567).",
      );
    }
    return `+${digits}`;
  }

  // DRC local forms without country code.
  if (s.startsWith("0")) {
    // Local trunk prefix (09x, 08x…) → DRC country code 243.
    const digits = `243${s.slice(1)}`;
    if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) {
      throw new PhoneError(
        "Numéro invalide — longueur incorrecte (ex. 0971234567).",
      );
    }
    return `+${digits}`;
  }
  if (s.startsWith("243")) {
    const digits = s.slice(0);
    if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) {
      throw new PhoneError(
        "Numéro invalide — longueur incorrecte (ex. +243971234567).",
      );
    }
    return `+${digits}`;
  }

  throw new PhoneError(
    "Numéro invalide — commencez par 0 (RD-Congo) ou par + (ex. +243971234567).",
  );
}

/** Deterministic virtual email for an E.164 number (identifier only). */
export function phoneToVirtualEmail(e164: string): string {
  if (!e164.startsWith("+")) {
    throw new PhoneError("Expected an E.164 number.");
  }
  return `${e164.slice(1)}@${PHONE_VIRTUAL_DOMAIN}`;
}

/** True if the address belongs to the reserved phone domain. */
export function isVirtualEmail(email: string): boolean {
  return (
    typeof email === "string" &&
    email.trim().toLowerCase().endsWith(`@${PHONE_VIRTUAL_DOMAIN}`)
  );
}
