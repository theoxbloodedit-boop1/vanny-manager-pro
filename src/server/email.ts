/**
 * EMAIL DELIVERY LAYER (ADR-0013) — the ONLY place emails leave the app.
 *
 * Two real, end-to-end flows:
 *   - Verification: signUp → Better Auth mints a signed token → this module is
 *     called with { user, url, token } → the recipient opens the url →
 *     /verify-email sets `emailVerified` → the org plugin unlocks invitations.
 *   - Password reset: Better Auth mints a signed token → this module is called
 *     with { user, url } → the recipient opens the url to set a new password.
 *
 * In both cases the token is signed by Better Auth and redeemed by a real
 * endpoint. Only the **delivery leg** (how the URL reaches a mailbox) is
 * environment-dependent.
 *
 * TRANSPORTS (env `MAIL_TRANSPORT`):
 *   "none"    (default) — email delivery DISABLED (ADR-0014). The app boots with
 *                         or without `RESEND_API_KEY`, makes NO network call, and
 *                         does NOT assert that a mail was sent (one honest,
 *                         PII-free "not sent" line). Verification is completed via
 *                         manual approval; recovery via assisted recovery.
 *   "resend"  (optional) — delivered over the Resend HTTP API using
 *                         `RESEND_API_KEY` + `RESEND_FROM` (a verified Resend
 *                         sender). A single `fetch` POST — no third-party SDK
 *                         (dependency discipline, serverless-friendly). Enabled
 *                         later by configuration ONLY (no code change).
 *   "capture" (tests)    — mails kept in memory, drained via takeCapturedMails().
 *   "smtp"    — NOT supported; throws (we deliver via the Resend API, not raw
 *               SMTP). The former "log" transport has been REMOVED (it was a
 *               fake production transport) and is now rejected.
 *
 * Non-production (dev/test) also records every outbound mail in the in-memory
 * outbox so the dev-only verification link and the test suites can read it.
 * This is never active in production and is NOT a delivery.
 *
 * Failure semantics (resend): a delivery failure THROWS. Better Auth invokes the
 * hook via `runInBackgroundOrAwait`, which catches and logs the error without
 * failing the sign-up response — so a transient provider outage does not break
 * sign-up or orphan the account, and the recipient can always resend via the
 * built-in `/api/auth/send-verification-email` endpoint.
 */
import { isVirtualEmail } from "./phone";

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML body (used by the Resend transport). Falls back to `text`. */
  html?: string;
  /** The action URL (verification / reset) — surfaced for capture & log. */
  url: string;
  /** The signed token (verification only; reset embeds it in `url`). */
  token?: string;
}

/** In-memory outbox used by tests and by the dev verification-link endpoint. */
const outbox: OutboundMail[] = [];

/** Tests / dev endpoint: drain the outbox and return what was captured so far. */
export function takeCapturedMails(): OutboundMail[] {
  return outbox.splice(0, outbox.length);
}

export interface EmailUser {
  name: string;
  email: string;
}

// ---------------------------------------------------------------------------
// HTML helpers (inline styles only — email clients strip <style> in <head>)
// ---------------------------------------------------------------------------

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

function buttonHtml(label: string, url: string): string {
  return (
    `<div style="margin:24px 0">` +
    `<a href="${escapeHtml(url)}" style="display:inline-block;background:#2563eb;color:#ffffff;"` +
    `text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600">` +
    `${escapeHtml(label)}</a></div>`
  );
}

function layoutHtml(title: string, bodyInner: string): string {
  return (
    `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;font-family:Arial,Helvetica,sans-serif;color:#1f2937">` +
    `<tr><td>` +
    `<h1 style="font-size:18px;margin:0 0 16px">${escapeHtml(title)}</h1>` +
    `${bodyInner}` +
    `<p style="font-size:12px;color:#9ca3af;margin:28px 0 0">Vanny Manager Pro</p>` +
    `</td></tr></table></td></tr></table></body></html>`
  );
}

function verificationHtml(name: string, url: string): string {
  return layoutHtml(
    "Confirmez votre adresse email",
    `<p style="font-size:15px;margin:0 0 8px">Bonjour ${escapeHtml(name)},</p>` +
      `<p style="font-size:15px;margin:0 0 8px">` +
      `Confirmez votre adresse email pour Vanny Manager Pro. Ce lien est personnel et expirera dans 24&nbsp;heures.</p>` +
      buttonHtml("Confirmer mon adresse", url) +
      `<p style="font-size:13px;color:#6b7280;margin:8px 0 0">Ou collez ce lien dans votre navigateur&nbsp;:</p>` +
      `<p style="font-size:13px;color:#2563eb;margin:4px 0 0;word-break:break-all">${escapeHtml(url)}</p>` +
      `<p style="font-size:13px;color:#6b7280;margin:16px 0 0">` +
      `Si vous n'avez pas de compte Vanny Manager Pro, ignorez simplement ce message.</p>`,
  );
}

function passwordResetHtml(name: string, url: string): string {
  return layoutHtml(
    "Réinitialisation de votre mot de passe",
    `<p style="font-size:15px;margin:0 0 8px">Bonjour ${escapeHtml(name)},</p>` +
      `<p style="font-size:15px;margin:0 0 8px">` +
      `Vous avez demandé la réinitialisation du mot de passe de votre compte. Ce lien est personnel et expire bientôt.</p>` +
      buttonHtml("Réinitialiser mon mot de passe", url) +
      `<p style="font-size:13px;color:#6b7280;margin:8px 0 0">Ou collez ce lien&nbsp;:</p>` +
      `<p style="font-size:13px;color:#2563eb;margin:4px 0 0;word-break:break-all">${escapeHtml(url)}</p>` +
      `<p style="font-size:13px;color:#6b7280;margin:16px 0 0">` +
      `Si ce n'est pas vous, ignorez ce message — votre mot de passe restera inchangé.</p>`,
  );
}

// ---------------------------------------------------------------------------
// Content builders
// ---------------------------------------------------------------------------

function verificationContent(
  user: EmailUser,
  url: string,
  token: string,
): OutboundMail {
  return {
    to: user.email,
    subject: "Confirmez votre adresse email — Vanny Manager Pro",
    text:
      `Bonjour ${user.name},\n\n` +
      "confirmez votre adresse email pour Vanny Manager Pro en ouvrant le lien ci-dessous. " +
      "Ce lien est personnel et expirera dans 24 heures.\n\n" +
      `${url}\n\n` +
      "Si vous n'avez pas de compte Vanny Manager Pro, ignorez simplement ce message.\n",
    html: verificationHtml(user.name, url),
    url,
    token,
  };
}

function passwordResetContent(user: EmailUser, url: string): OutboundMail {
  return {
    to: user.email,
    subject: "Réinitialisation de votre mot de passe — Vanny Manager Pro",
    text:
      `Bonjour ${user.name},\n\n` +
      "vous avez demandé la réinitialisation du mot de passe de votre compte Vanny Manager Pro. " +
      "Ouvrez le lien ci-dessous pour définir un nouveau mot de passe. " +
      "Ce lien est personnel et expire bientôt.\n\n" +
      `${url}\n\n` +
      "Si ce n'est pas vous, ignorez ce message — votre mot de passe restera inchangé.\n",
    html: passwordResetHtml(user.name, url),
    url,
  };
}

// ---------------------------------------------------------------------------
// Resend delivery (HTTP API, no SDK)
// ---------------------------------------------------------------------------

const RESEND_API_URL = "https://api.resend.com/emails";

async function sendViaResend(mail: OutboundMail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "MAIL_TRANSPORT=resend requires RESEND_API_KEY. " +
        "Set it (and RESEND_FROM) for production delivery — ADR-0013.",
    );
  }
  const from = process.env.RESEND_FROM;
  if (!from) {
    throw new Error(
      "MAIL_TRANSPORT=resend requires RESEND_FROM — a verified Resend sender " +
        "(e.g. \"Vanny Manager <no-reply@yourdomain.com>\").",
    );
  }

  // 5 s cap: Resend p99 is well under 2 s, but in a serverless runtime a hung
  // call must not consume the function's time budget (Better Auth awaits this).
  const timeoutMs = Number(process.env.RESEND_TIMEOUT_MS ?? 5_000);

  let res: Response;
  try {
    res = await fetch(RESEND_API_URL, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: mail.to,
        subject: mail.subject,
        html: mail.html ?? mail.text,
        text: mail.text,
      }),
    });
  } catch (e) {
    // Network-level failure (DNS, timeout, refused) or AbortSignal timeout.
    // Log server-side (never the API key); rethrow a safe message.
    console.error("[email:resend] network error:", e);
    throw new Error("Email delivery failed (network).");
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { name?: unknown; message?: unknown };
      if (typeof j.message === "string") {
        detail = `${res.status}${typeof j.name === "string" ? ` ${j.name}` : ""} ${j.message}`;
      }
    } catch {
      /* non-JSON error body — keep the status code */
    }
    // Log the provider error server-side; surface a safe message to the caller.
    console.error("[email:resend] delivery rejected:", detail);
    throw new Error(`Email delivery failed (Resend ${detail}).`);
  }
}

// ---------------------------------------------------------------------------
// Transport dispatch — the single choke point
// ---------------------------------------------------------------------------

/**
 * ADR-0016: phone accounts carry a deterministic VIRTUAL email
 * (`<digits>@phone.vanny.app`) that is an identifier only — it is never a
 * real mailbox. No mail is ever recorded or delivered for it (no network,
 * no outbox row, one PII-free log line).
 */
export async function deliverMail(mail: OutboundMail): Promise<void> {
  if (isVirtualEmail(mail.to)) {
    console.log(
      "[email:phone] mail skipped — recipient is a phone-account virtual email (no mailbox).",
    );
    return;
  }
  const transport = process.env.MAIL_TRANSPORT ?? "none";
  const isProduction = process.env.NODE_ENV === "production";
  // Non-production: always record in the in-memory outbox (dev verification
  // link + test suites). Production: only an explicit "capture" records — and
  // it is never expected in production. Recorded exactly once.
  if (!isProduction || transport === "capture") outbox.push(mail);

  switch (transport) {
    case "none":
      // Email delivery disabled (ADR-0014): no network, no provider, and NO
      // "sent" assertion. One honest, PII-free line (no recipient, no signed
      // URL/token in logs). Verification → manual approval; recovery → assisted.
      console.log(
        "[email:disabled] outbound mail not sent (transport disabled); " +
          "complete via manual approval / assisted recovery.",
      );
      return;
    case "resend":
      await sendViaResend(mail);
      return;
    case "capture":
      return; // recorded above; no network
    case "smtp":
      throw new Error(
        "MAIL_TRANSPORT=smtp is not supported. Use MAIL_TRANSPORT=resend with " +
          "RESEND_API_KEY + RESEND_FROM for production delivery (ADR-0013/0014).",
      );
    default:
      // Includes the removed "log" transport, which is now rejected.
      throw new Error(
        `Unknown MAIL_TRANSPORT: ${String(transport)} (valid: none, resend, capture)`,
      );
  }
}

// ---------------------------------------------------------------------------
// Better Auth hooks
// ---------------------------------------------------------------------------

/** Better Auth `emailVerification.sendVerificationEmail` hook. */
export async function sendVerificationEmail(payload: {
  user: EmailUser;
  url: string;
  token: string;
}): Promise<void> {
  await deliverMail(verificationContent(payload.user, payload.url, payload.token));
}

/** Better Auth `emailAndPassword.sendResetPassword` hook. */
export async function sendPasswordResetEmail(payload: {
  user: EmailUser;
  url: string;
}): Promise<void> {
  await deliverMail(passwordResetContent(payload.user, payload.url));
}
