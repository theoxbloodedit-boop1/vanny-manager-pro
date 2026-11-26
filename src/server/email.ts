/**
 * EMAIL DELIVERY LAYER (ADR-0013) — the ONLY place emails leave the app.
 *
 * Verification flow (real, end-to-end):
 *   signUp → Better Auth mints a signed token → this module is called with
 *   { user, url, token } → the recipient opens the url → /verify-email sets
 *   `emailVerified` → the org plugin unlocks invitation acceptance.
 *
 * TRANSPORTS (env `MAIL_TRANSPORT`):
 *   "capture" (tests) — mails are kept in memory, retrieved via takeCapturedMails().
 *   "log"     (dev)   — mails are logged to the server console. No SMTP needed.
 *   "smtp"    (prod)  — NOT YET IMPLEMENTED: throws. Production deployment
 *                       (Phase 7) must configure a real provider here. Until
 *                       then, shipping to production with this layer
 *                       unimplemented is forbidden by the runbook.
 *
 * The flow is never faked: the token is always signed by Better Auth and
 * verified by /verify-email. Only the transport (how the message reaches
 * the mailbox) varies by environment.
 */

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  url: string;
  token: string;
}

/** In-memory outbox used by tests (and by the "log" transport for debugging). */
const outbox: OutboundMail[] = [];

/** Tests: drain the outbox and return what was captured so far. */
export function takeCapturedMails(): OutboundMail[] {
  return outbox.splice(0, outbox.length);
}

export interface VerificationEmailPayload {
  user: { name: string; email: string };
  url: string;
  token: string;
}

/** Better Auth `emailVerification.sendVerificationEmail` hook. */
export async function sendVerificationEmail(
  payload: VerificationEmailPayload,
): Promise<void> {
  const mail: OutboundMail = {
    to: payload.user.email,
    subject: "Confirmez votre adresse email — Vanny Manager Pro",
    text:
      `Bonjour ${payload.user.name},\n\n` +
      "confirmez votre adresse email pour Vanny Manager Pro en ouvrant le lien ci-dessous. " +
      "Ce lien est personnel et expirera dans 24 heures.\n\n" +
      `${payload.url}\n\n` +
      "Si vous n'avez pas de compte Vanny Manager Pro, ignorez simplement ce message.\n",
    url: payload.url,
    token: payload.token,
  };

  const transport = process.env.MAIL_TRANSPORT ?? "log";
  switch (transport) {
    case "capture":
      outbox.push(mail);
      return;
    case "log":
      outbox.push(mail);
      // Dev convenience: the verification URL is visible in server logs.
      console.log(
        `[email:log] verification mail → ${mail.to}\n           ${mail.url}`,
      );
      return;
    case "smtp":
      throw new Error(
        "MAIL_TRANSPORT=smtp is not implemented yet — production email " +
          "delivery must be configured before deploying (ADR-0013).",
      );
    default:
      throw new Error(`Unknown MAIL_TRANSPORT: ${String(transport)}`);
  }
}
