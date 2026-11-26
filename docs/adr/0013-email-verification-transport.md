# ADR-0013 — Email verification flow and the transport split (log / capture / smtp)

**Status:** ACCEPTED · **Date:** 2026-11-25 · **Supersedes:** none

## Context

The Better Auth organization plugin **hard-blocks** listing and accepting
invitations unless the session's email is verified. We keep that control — it
prevents "register an arbitrary email and harvest an invitation addressed to
it". So a real verification flow is required.

Better Auth (1.7.27) provides the machinery: on sign-up it mints a **signed
token**, builds `${BETTER_AUTH_URL}/verify-email?token=…`, and calls our
`emailVerification.sendVerificationEmail({ user, url, token })` hook; the
`/verify-email` endpoint redeems the token and sets `emailVerified`. The flow
is fully real; only the **delivery leg** (how the URL reaches a mailbox) is
environment-dependent. The sandbox has no SMTP provider, and the brief forbids
simulated integrations — so we make the transport an explicit, documented
configuration rather than faking an email provider.

## Decision

`src/server/email.ts` is the **only** place emails leave the application.
Transport selected by `MAIL_TRANSPORT`:

| Transport | Behavior | Where used |
|---|---|---|
| `capture` | mails kept in memory, drained via `takeCapturedMails()` | integration tests |
| `log` | mails logged to the server console (and kept in the in-memory outbox) | local dev / sandbox |
| `smtp` | **not implemented — throws** | production **must** implement a real provider here before any deploy |

Additional rules:

1. **No auto-verification.** `requireEmailVerification` stays off for sign-in
   (we don't lock users out before their first mail arrives), but the
   invitation flow remains gated by the plugin's verified-email check. The
   security-critical gate is where it matters.
2. **Dev-only verification endpoint** — `GET /api/dev/verification-link`
   (`src/server/me.ts → devVerificationLink`) returns the signed URL for the
   signed-in user's email. It is available **only** when
   `NODE_ENV !== "production"` **and** `MAIL_TRANSPORT === "log"`; in every
   other configuration it is a 404. It never weakens the flow — the URL is the
   same signed token a real mailbox would deliver; the endpoint only skips the
   mailbox leg, which the sandbox cannot provide.
3. Verification links expire in 24 h (`emailVerification.expiresIn`).
4. `sendResetPassword` uses the same philosophy (labeled dev transport,
   already in place since Phase 1a).

## Consequences

- **+** The verification flow is real and tested (integration suite asserts
  the unverified gate, then completes verification via the signed token).
- **+** Production cannot silently run without email: `MAIL_TRANSPORT=smtp`
  throws, and `log` is a no-go for prod (documented in the runbook).
- **−** Dev environments can complete verification without a mailbox — an
  accepted convenience, hard-disabled in production by the double gate.
- **−** One more env var to document (`MAIL_TRANSPORT`).

## Verification

- `tests/integration/auth-tenancy.test.ts`:
  - unverified email → `GET /api/invitations` rejected;
  - `verifyEmail({ token })` (the real endpoint) → `status: true`;
  - verified email → invitation visible and acceptable.
- HTTP walk: `GET /api/dev/verification-link` returns a signed URL that
  `GET /api/auth/verify-email?token=…` redeems.
