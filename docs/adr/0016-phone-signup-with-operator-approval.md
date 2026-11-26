# ADR-0016 — Phone (WhatsApp) sign-up with operator approval

**Status:** ACCEPTED — owner decision 2026-11-26 (option « validation manuelle, gratuite »)
**Date:** 2026-11-26
**Related:** ADR-0014 (manual approval + operator tokens), ADR-0013 (email transport), ADR-0012 (Better Auth tenancy)
**Supersedes:** none — extends ADR-0014's manual approval from a CLI script to an in-app operator dashboard

---

## 1. Context — the product decision

A significant share of the target customers (DRC SMEs, market traders) has no
e-mail address and does not know how to use Gmail. Requiring a mailbox blocks
their sign-up at the very first step.

The owner chose (2026-11-26):

1. **Sign-up with a WhatsApp phone number + password** (no email required).
2. **Identity verification = manual approval by the operator** (VANNY team),
   free, via the app. No SMS OTP (paid), no Meta WhatsApp Business API
   (long approval process, paid per message).
3. Scope now: **new customers** (self-serve sign-up + onboarding). Staff are
   still invited by email.

Honest limitation (accepted by the owner): with manual approval we do not
cryptographically prove the number belongs to the signer. The operator
confirms identity over WhatsApp / by phone before approving. This is the same
trust model as ADR-0014's assisted recovery.

## 2. Design

### 2.1 Identity model — phone + virtual email

- A phone account stores its number (E.164) in a new **`user.phone`** column
  (unique; migration **0005** — 0004 is reserved for ADR-0015 tenant theming).
- Better Auth's email account is the identity primitive, so every phone user
  also gets a **deterministic virtual email**:

      +243971234567  →  243971234567@phone.vanny.app

  The virtual email is the *identifier only*. It is **never a delivery
  address**: the mail layer (ADR-0013 choke point, `deliverMail`) silently
  skips the `phone.vanny.app` domain (one PII-free log line, no network,
  no outbox record).
- **Domain protection:** the Better Auth HTTP surface (our `[...all]`
  catch-all) rejects `/sign-up/email` bodies whose email is in the virtual
  domain, so an attacker cannot squat a phone account's identifier through
  the email path. Phone sign-up goes through the dedicated
  `POST /api/auth/sign-up/phone` route, which the guard does not touch.
- Sign-in is unified: the auth form accepts **email or phone** in one field
  (no `@` → phone path → virtual email → standard credential check).

### 2.2 Trust gate — the approval is the security control

A phone account is **inert** until a platform operator approves it:

- **Onboarding (org creation) is gated server-side**:
  `runOnboarding` now requires `emailVerified OR manuallyApproved` (403
  `VERIFICATION_REQUIRED` otherwise). This also **closes a pre-existing gap**:
  before this ADR the gate existed only in the client, so a direct API call
  could bypass email verification and create an org. The email path is
  strictly tightened by this change.
- **Invitation acceptance** keeps its ADR-0014 gate
  (`emailVerified OR manuallyApproved`) — unchanged.
- Spam/impersonation: an unapproved account cannot create an org, accept an
  invitation, or read any tenant data (no session → no active org). Mass
  sign-ups therefore produce only inert rows.

### 2.3 Operator dashboard — in-app, same trust model as the CLI

ADR-0014's manual approval ran as a server script with a 15-minute operator
token. The dashboard needs the same operation **inside the app**, one click:

- `GET /api/operator/approvals` — pending phone sign-ups (+ recent approvals).
- `POST /api/operator/approvals` — `{ phone, action: approve|revoke, reason }`.
- **Operator identity = the authenticated session**, checked server-side on
  every call: `session.user.email ∈ PLATFORM_OPERATOR_EMAILS` (the existing
  fail-closed allowlist). In the app, the session cookie IS the authenticated
  execution context — no intermediate token to mint or leak. The CLI token
  path (ADR-0014) remains available and unchanged.
- The mutation reuses **`applyManualApproval()` verbatim**: `user.manually_approved`
  update + append-only `manual_approvals` audit row in ONE transaction.
  `emailVerified` is never touched. A **reason is mandatory** (the UI
  pre-fills "Identité confirmée par WhatsApp" — one click, audit still
  explicit).
- Revoke is included (operator approved by mistake). No user deletion —
  revoking makes the account inert again; deletion is out of scope.

### 2.4 Surfaces

- `/auth` — sign-up gets an **Email / WhatsApp** segmented choice (WhatsApp:
  name + phone + password); sign-in keeps one field (« Email ou WhatsApp »).
- `/post-auth` — new states for phone users: *en attente de validation*
  (auto-refresh every 4 s; explains the WhatsApp confirmation step) and
  *compte validé* (straight to onboarding). Email flow untouched.
- `/operator` — operator-only page (pending list + approve/revoke).
- `/admin` — members list shows the phone number instead of the virtual email
  (members service enriches from the platform `user` table).
- `/api/me` — now returns `phone` and `manuallyApproved`.

## 3. Non-goals / follow-ups

- **Password reset for phone users** is not self-serve (the reset mail goes
  to the virtual address and is skipped). Recovery = **assisted** (owner
  decision, ADR-0014 §2.3): the customer contacts VANNY on WhatsApp; the
  operator assists. Surfaced as a hint in the sign-in error path.
- **Staff invited by phone** — later; staff are currently invited by email
  (owner scope decision 2026-11-26).
- **SMS / WhatsApp OTP** — if ever wanted, it would replace the approval gate
  for a subset of users and requires a paid provider. The virtual-email
  identity model makes it additive, not a rewrite.
- No rate limiting beyond Better Auth's built-in limiter for its own routes;
  the approval gate already neutralizes the abuse mode (inert accounts).

## 4. Migration / rollout

- Migration **0005** (`user.phone text` + unique index) — applied to Neon
  production with the deploy kit's `apply-migrations` after merge.
- No new environment variables. `PLATFORM_OPERATOR_EMAILS` (already set) is
  the operator allowlist for the dashboard.
- Rollout: merge → CI green → Neon migration 0005 → Vercel deploy. Existing
  email accounts and flows are unaffected (additive column + tightened gate).

## 5. Test strategy

- Unit: E.164 normalization (DRC `09x` → `+2439x`, `+243`, bare `243`,
  invalids) and the phone → virtual-email mapping.
- Integration (real PostgreSQL, new `phone` suite): full journey
  sign-up(phone) → inert (onboarding 403, invitation accept 403) → operator
  list → approve (audit row asserted) → onboarding OK → sign-in by phone →
  duplicate phone 409 → non-operator 403 → email sign-up of a virtual-domain
  address rejected → unverified **email** user now also blocked from
  onboarding (the gate fix).
