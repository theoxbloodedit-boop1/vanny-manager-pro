/**
 * ADR-0017 — Invitation links shared over WhatsApp (option A: free, zero-
 * backend, no Meta API account).
 *
 * SECURITY MODEL
 *   The shareable link is the app's own sign-in/sign-up page pre-filled with
 *   the invitee's email: `/auth?email=<email>`. It carries NO token and leaks
 *   nothing beyond what the invitation email already states — the invitation
 *   identity IS the email. Acceptance stays fully gated by the Better Auth
 *   organization plugin (recipient-email match, single-use, expiry) and by
 *   our verification / manual-approval gate (ADR-0014).
 *
 * DELIVERY
 *   `https://wa.me/<e164>?text=<message>` opens the OWNER's WhatsApp with the
 *   message pre-filled. The owner presses send. No API, no per-message cost,
 *   no template approval.
 */

/**
 * Strip spaces / dashes / dots / parens and a leading `+`; returns the pure
 * digit string ("" when letters or other symbols are present).
 */
export function digitsOnly(raw: string): string {
  const s = raw.replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(s)) return "";
  return s.replace("+", "");
}

/**
 * Normalize a human phone number to E.164 digits for wa.me.
 *
 *   +243978508099      → "243978508099"
 *   +243 978 508 099   → "243978508099"
 *   0978508099         → "243978508099"   (DRC local: 0 → 243)
 *   00243978508099     → "243978508099"
 *
 * Returns null when the input cannot be a valid international number
 * (E.164: 8–15 digits). The `0` → `243` rewrite is deliberate: DRC is the
 * target market and local mobile numbers are `0` + 9 digits (exactly 10
 * digits). Any remaining leading 0 is rejected (not international, not a
 * DRC local number).
 */
export function normalizeWaPhone(raw: string): string | null {
  let d = digitsOnly(raw);
  if (d === "") return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 10) {
    d = `243${d.slice(1)}`;
  }
  if (d.startsWith("0")) return null;
  if (!/^\d{8,15}$/.test(d)) return null;
  return d;
}

/**
 * The shareable app link: the auth page pre-filled with the invitee's email.
 * `baseUrl` should be the origin serving the app (window.location.origin on
 * the client).
 */
export function buildInviteAppUrl(baseUrl: string, email: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/auth?email=${encodeURIComponent(email)}`;
}

/** The WhatsApp pre-fill message (fr, plain text — wa.me renders no markup). */
export function buildInviteMessage(
  orgName: string,
  email: string,
  appUrl: string,
): string {
  return (
    `Bonjour ! Vous avez été invité·e à rejoindre « ${orgName} » sur ` +
    `VANNY Manager Pro. Créez votre compte (ou connectez-vous) avec l'adresse ` +
    `${email}, puis acceptez l'invitation : ${appUrl}`
  );
}

/** `https://wa.me/<e164 digits>?text=<message>` — opens the owner's WhatsApp. */
export function buildWhatsAppUrl(phoneE164: string, message: string): string {
  return `https://wa.me/${phoneE164}?text=${encodeURIComponent(message)}`;
}
