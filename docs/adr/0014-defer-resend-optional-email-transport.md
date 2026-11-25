# ADR-0014 — Defer Resend: optional email transport + manual operations (WhatsApp-first)

**Status:** PROPOSED v2 — reflects owner decisions (2026-11-25); awaiting final validation
**Date:** 2026-11-25
**Related:** ADR-0012 (Better Auth tenancy), ADR-0013 (email transport split)
**Supersedes:** none — refines ADR-0013's "production must use a provider" clause

---

## 1. Context — the product decision

VANNY MANAGER PRO initially targets African SMEs and merchants, especially the DRC.
Resend is **not** a launch dependency. At launch, customer operations (support,
onboarding, payment confirmation, subscription activation, renewal reminders) are
performed **manually** by the VANNY team, WhatsApp-first. Better Auth security is
**never** weakened. No paid WhatsApp API, no automated payment, no Mobile Money
integration, and no production deployment without explicit validation.

## 2. Binding decisions (owner, 2026-11-25)

| # | Decision |
|---|---|
| 1 | **Transport:** `none` is the default. Keep `resend` as an optional transport (activable later). **Remove `log`** as a fake production transport. |
| 2 | **Manual approval:** do **not** touch `emailVerified`. Use a **distinct `manuallyApproved`** flag. First version: an **audited server script**, run only by an authenticated, authorized platform operator. |
| 3 | **Recovery:** keep automatic reset when Resend is enabled. Without email: **assisted recovery** with an identity procedure, a **one-time temporary token**, and logging. No password over WhatsApp. |
| 4 | **Invitations:** relax **only** the email verification required to **accept** an invitation. Keep invitation-token verification, expiry, single-use, and permission control. |
| 5 | **Scope now:** implement the optional transport + the secure invitation adaptation. **Prepare** manual approval, but do not build its full workflow. |
| 6 | **WhatsApp / subscriptions:** design only. No WhatsApp API, no automated payment, no Mobile Money now. Manual operations must be **traceable in the architecture**. |

**Additional requirements (Arena):**
- A manual approval must **never** mean an email-address verification.
- Administrative operations must record **operator, affected user, action, date, reason**.
- **No public endpoint** for manual verification.
- **No secret or password in logs.**
- Tests must show that **disabling Resend does not break** authorized sign-up or the
  available auth flows.
- **No deployment** without validation.

## 3. Analysis — what actually depends on email (code-verified, Better Auth 1.7.27)

**Gated on `session.user.emailVerified`** (org plugin, `crud-invites.mjs`):

| Endpoint | Gate | Configurable? |
|---|---|---|
| `POST /organization/accept-invitation` | verified email | via `requireEmailVerificationOnInvitation` |
| `POST /organization/reject-invitation` | verified email | via `requireEmailVerificationOnInvitation` |
| `GET /organization/get-invitation` | verified email | via `requireEmailVerificationOnInvitation` |
| `GET /organization/list-user-invitations` | verified email | **hard check (not configurable)** |

**NOT gated on verified email:** `createOrganization`/onboarding, sign-up, sign-in,
session. (The **owner can create their org without verification**.)

**Email-delivery dependent (self-service):** password reset (the signed reset URL is
delivered by email).

**Invitations themselves** use Better Auth's signed, expiring, **single-use** tokens —
creating/passing the link needs **no email**.

Startup is **not** blocked by a missing `RESEND_API_KEY` (the throw only occurs at
send-time under `MAIL_TRANSPORT=resend`). The launch gaps are the **verification
mechanism** and **account recovery**, not startup.

## 4. Design

### 4.1 Email transport — optional and honest (`src/server/email.ts`)

Valid transports: **`none`** (default), **`resend`** (optional), **`capture`** (tests).
**`log` is removed** (it was a fake production transport). The `smtp` stub is retained
(throws, points to `resend`).

- **`none` (default):** the app boots with or without `RESEND_API_KEY` (no startup
  throw). **No network / no Resend call.** `sendVerificationEmail` and
  `sendResetPassword` become **no-ops that do not assert delivery**: they return
  without sending and log one clear line (e.g. `[email:disabled] verification not sent;
  complete via manual approval / assisted recovery`) — **never** a "sent" claim, and
  **no secret or password** in the line.
- **`resend`:** enabled later **by configuration only** (`MAIL_TRANSPORT=resend` +
  `RESEND_API_KEY` + `RESEND_FROM`) — **no code change** (preserves the future
  integration option).
- **Dev path:** the dev-only verification link (`GET /api/dev/verification-link`) is
  re-gated to **`NODE_ENV !== "production"`** (previously `AND MAIL_TRANSPORT ===
  "log"`); it remains a **404 in production**. It is the dev mechanism to exercise the
  email-verified path.
- Setting `MAIL_TRANSPORT=log` is now **rejected** (not a valid transport).

### 4.2 Manual approval — distinct from email verification

- A **distinct `manuallyApproved`** flag. It **never** means "email verified" — it means
  "an operator approved this user to join." (Requirement.)
- **Storage:** `users.manually_approved` (boolean, default `false`) **plus** a
  platform-level **`manual_approvals`** audit table
  (`id`, `user_id`, `operator`, `action`, `reason`, `created_at`). The flag is what the
  invitation gate reads; the table is the durable audit record.
- **Set ONLY by an audited server script** run by an **authenticated, authorized
  platform operator** with server access. **No public endpoint** (requirement). The
  script records **operator, affected user, action, date, reason** (requirement) and
  writes no secret/password to logs.
- **Prepared this iteration** (schema + script + audit table). The full operator
  workflow/UI is **not** built this iteration.

### 4.3 Account recovery

- **Resend enabled** → automatic reset (unchanged, via the signed reset URL).
- **No email** → **assisted recovery**: the operator verifies the customer's identity
  (a documented procedure; **never** asking for a password or OTP over WhatsApp), then
  issues a **one-time temporary token** (signed, expiring, single-use) that lets the
  customer set a new password; every step is logged (operator, user, action, date,
  reason). *(Design for a follow-up — not implemented this iteration.)*

### 4.4 Invitations — relax ONLY the acceptance email-verification

- **Kept (plugin-enforced, unchanged):** invitation-token verification, expiry,
  single-use, and permission control.
- **Relaxed:** the `emailVerified` requirement for the **acceptance flow**
  (`get-invitation` + `accept-invitation`). Replaced by a **server-side gate** in our
  route: the user must be **`emailVerified` OR `manuallyApproved`** (RLS-scoped read).
- **Implementation:** set `requireEmailVerificationOnInvitation: false` on the org
  plugin (disables its email check for get/accept/reject) **and** add our own gate in
  the accept route enforcing `emailVerified OR manuallyApproved`. The plugin continues
  to enforce token/expiry/single-use/permissions, so nothing about the link's security
  changes.
- **`list-user-invitations` remains email-gated** (hard plugin check). A
  manually-approved but not email-verified user can **accept via their direct link**
  (get + accept are relaxed) but the "your invitations" list stays gated. *(Flagged —
  see §9.)*

### 4.5 WhatsApp-first operations & manual subscriptions — design only

- **Launch model:** manual by the VANNY team (WhatsApp-first). No paid WhatsApp API; no
  automated payment; no Mobile Money integration now.
- **Traceability requirement:** every manual operation (approval, assisted recovery,
  payment verification, subscription activation) writes an **audit-log entry**
  (operator, user, action, date, reason) so the manual model is traceable in the
  architecture.
- **Subscriptions (Mobile Money) — data-model design (separate authorized module):** a
  payment/subscription model capturing transaction reference, amount, currency, payment
  date, `status` (`pending_verification → verified → activated`), verifying operator,
  activation timestamp, renewal history, and an audit entry per state change.
  Activation **only** after an operator sets `verified`; **no** simulated automatic
  Mobile Money confirmation.

## 5. Scope for this iteration

- **Implement:**
  1. Optional email transport (`none` default; keep `resend`; **remove `log`**; re-gate
     the dev verification link).
  2. Secure invitation adaptation (acceptance gate = `emailVerified OR
     manuallyApproved`; invitation-token security kept).
- **Prepare (not full workflow):**
  3. Manual approval — `users.manually_approved` + `manual_approvals` audit table +
     audited server script (no public endpoint).
- **Design only (not built):** assisted recovery; WhatsApp operations; subscriptions /
  Mobile Money; the full operator workflow/UI.
- **Not done:** any production deployment.

## 6. Consequences

- **+** Fully operable at launch **without Resend**: an owner signs up and onboards
  immediately; staff join after a manual approval; the owner path needs no
  verification at all.
- **+** Security preserved: the invitation link's token/expiry/single-use/permission
  security is unchanged; the email-verification gate is **replaced, for acceptance
  only**, by an audited `manuallyApproved` (or real `emailVerified`) check; `emailVerified`
  itself is never set by a manual action.
- **+** Resend is a later **configuration flip** (no code change).
- **+** Every manual/admin action is **traceable** (operator, user, action, date,
  reason).
- **−** Staff verification and password recovery are **manual / human-in-the-loop** at
  launch — an intentional, documented trade-off for the initial market.
- **−** A privileged script path exists (mitigated: no public endpoint, operator-only,
  audit-logged, no secrets in logs).

## 7. Verification plan (tests)

**Preserved (baseline 73/73, re-targeted where the default transport / `log` changes):**
14 `auth-tenancy` + 13 `isolation` + the rest.

**Added (no-Resend behavior):**
- `none` is the default; the auth instance **constructs with no `RESEND_API_KEY`**;
  `sendVerificationEmail` / `sendResetPassword` make **no** fetch call and **do not**
  report success; a captured log line asserts **no** "sent" and **no** secret/password.
- `MAIL_TRANSPORT=log` is **rejected** (not a valid transport).
- **Invitation adaptation (integration, real PG):** an unverified, non-approved user is
  **blocked** from accepting; after `manuallyApproved` (set by the audited script), the
  same user **accepts** the invitation (token still validated/expiring/single-use) and
  branch access materializes; the `manual_approvals` row records operator, user, action,
  date, reason.
- **`manuallyApproved` ≠ `emailVerified`:** a manually-approved user has
  `emailVerified = false` (asserted) — approval never implies email verification.
- **Disabling Resend does not break available flows:** sign-up works under `none`;
  sign-in/session work; **owner onboarding works without verification**.
- **Resend regression:** with `MAIL_TRANSPORT=resend` + keys, delivery still posts to
  Resend (existing unit tests).
- **No secrets in logs:** assert no `RESEND_API_KEY`/password appears in captured output
  across transports.

## 8. Out of scope (deferred — require explicit authorization)

- Paid **WhatsApp API** integration.
- The **subscription / Mobile Money** module (designed in §4.5, not built).
- The full **operator workflow / platform-admin** surface.
- Any **production deployment**.

## 9. Open questions (for final validation)

1. **`list-user-invitations` stays email-gated** (a manually-approved user can accept
   via their direct link, but the "your invitations" list returns 403 until email-
   verified). Per "relax ONLY acceptance" I kept it gated. **Acceptable, or should the
   list be relaxed too?**
2. **`manually_approved` storage:** I propose a `users.manually_approved` column **plus**
   the `manual_approvals` audit table (flag for the gate, table for the record).
   **Confirm**, or prefer a platform-only approval table with a derived flag.
3. **Operator identity for the script:** how is the operator "authenticated and
   authorized"? I propose a server-run script that takes the operator identity at
   invocation (no public endpoint, no stored operator password). **Confirm the
   operator-identity mechanism.**

## 10. Validation outcome, implementation & execution proof (2026-11-25)

**Owner validation (2026-11-25):** all three §9 points validated, with the
following binding conditions. Implementation was **authorized** (exclusive scope).

1. **`list-user-invitations` stays strictly `emailVerified`** — CONFIRMED. A
   manually-approved user accepts **only** via the direct secure link and CANNOT
   view the invitation list without real email verification. Implemented as-is.
2. **Storage = `users.manually_approved` + `manual_approvals`** — CONFIRMED, with:
   status update + audit insert in a **single transaction**; **append-only**
   history (DB trigger `manual_approvals_append_only` blocks UPDATE/DELETE for all
   roles); **every revocation recorded**; `manuallyApproved` **never** touches
   `emailVerified`; approval grants **no** organization access.
3. **Operator identity = from a VERIFIED token, never a CLI argument** — CONFIRMED
   (and strengthened): the script (`scripts/manual-approval.mts`) derives the
   operator's real identifier from a verified HS256 operator token
   (`src/lib/operator-token.ts`, constant-time signature check) — **there is no
   `--operator` argument**. It fails closed on missing/invalid/expired/wrong-role
   tokens. No operator password is stored. Audit records operator id, affected
   user, action, UTC date, mandatory reason, operation id.

**FINAL GUARDRAIL (owner):** a manually-approved user attempting to accept
**another organization's** invitation MUST FAIL; the link stays bound to its own
invitation + original organization. Implemented and tested.

### What was built (files)
| Area | Change |
| --- | --- |
| `src/server/email.ts` | Transport `none` (default) / `resend` (opt-in) / `capture` (tests). **`log` REMOVED** (now rejected). `none` makes no network call and never asserts a send. Non-prod records to the outbox for the dev link / tests. |
| `src/server/me.ts` | Dev verification link re-gated on `NODE_ENV !== "production"` only. |
| `src/auth/index.ts` | `requireEmailVerificationOnInvitation: false` (disables the plugin's email check on accept/reject/get-invitation; `list-user-invitations` stays hard-gated). |
| `src/server/members.ts` | `acceptInvitation` gate = `emailVerified OR manuallyApproved`; `myInvitations` unchanged (strict). Token/expiry/single-use/recipient-match/permission control retained by the plugin. |
| `src/db/schema/auth.ts` | `users.manually_approved` + `manual_approvals` (platform, not RLS). |
| `src/db/migrations/0001_closed_lord_tyger.sql` | New table + column + append-only trigger. |
| `src/lib/operator-token.ts` | Dependency-free HS256 issue/verify (fails closed). |
| `src/server/manual-approval.ts` | Single-transaction status update + append-only audit; `emailVerified` never written. |
| `scripts/manual-approval.mts` | Audited operator-only script; identity from verified token; no public endpoint; no stored password. |
| `.env.example` | `MAIL_TRANSPORT` (none/resend/capture), Resend keys, `OPERATOR_TOKEN_SECRET`. |

### Execution proof (gates, 2026-11-25)
- `tsc --noEmit` → **0** errors
- `eslint .` → **0** errors
- `vitest run` → **93/93 passed** (8 files)
  - unit: prices 15, uuid 6, email **14**, permissions 13, **operator-token 7**
  - integration: auth-tenancy **14**, isolation **13**, **adr0014 11**
- `next build` → **0** (18 routes) · `pwa:guard` → OK
- Secret scan: operator identity never a CLI argument; no hard-coded secret;
  `none`/script logs carry no password/token.

**adr0014 integration coverage (11):** no-Resend sign-up/sign-in/session with no
network · `manuallyApproved ≠ emailVerified` · revocation recorded · fails-closed
(reason/operator/unknown user) · unverified-refused → approved → accepts own
invitation (email still unverified) · **list stays strict** · **FINAL GUARDRAIL
cross-org acceptance must fail** · script success (valid token) · **script fails
closed (forged token)** · script refuses without token · Resend regression
(re-enabled delivery POSTs to Resend).

**Not done (per scope / owner):** no merge to main, no deployment, no other
modules. Assisted recovery, WhatsApp ops, and manual subscriptions remain
design-only (documented in §4.3/§4.5).

## 11. CTO hardening — operator-token identity, revocation & TTL (2026-11-25)

**CTO decision:** implement a unique `jti`, individual revocation, a 15-minute
TTL, and issuance tied to an authenticated platform-operator session. Revocation
is enforced server-side on every use; issuances and revocations are journaled;
no public admin endpoint.

### What changed
| Area | Change |
| --- | --- |
| `src/lib/operator-token.ts` | Every token carries a unique `jti` (UUID); default TTL **900s (15 min)**; `verifyOperatorToken` returns `{sub, jti}` and refuses any token **without a `jti`** (legacy tokens cannot be revoked). |
| `src/db/schema/auth.ts` + `migrations/0002_real_karnak.sql` | Two **append-only** platform ledgers (NOT RLS): `operator_token_issuances` (jti, operator_sub, operator_email, ttl_seconds, issued_at) and `operator_token_revocations` (jti, revoker_sub, reason, revoked_at). Both have `BEFORE UPDATE OR DELETE` triggers that RAISE (no UPDATE/DELETE for any role). |
| `src/server/operator-token.ts` | Server-side, NO public endpoint. `issueOperatorTokenForAuthenticatedSession(headers)` = verify session (authentication) + `PLATFORM_OPERATOR_EMAILS` allowlist (authorization) → mint `sub`=session user id, `jti`, 15-min → append-only issuance row + log. `revokeOperatorToken(headers, jti, reason)` = authenticated + authorized + mandatory reason → append-only revocation row + log. `verifyOperatorTokenFull(token, secret)` = sync verify **AND** async revocation check, used on EVERY use. `isOperatorTokenRevoked(jti)` reads the denylist. |
| `scripts/operator-token.mts` | Server script: `issue` / `revoke --jti <uuid> --reason <text>`. Identity from the operator's **authenticated session cookie** (`OPERATOR_SESSION_COOKIE`), never typed. |
| `scripts/manual-approval.mts` | Now calls `verifyOperatorTokenFull` (sync + revocation check) on every run — a **revoked jti fails closed**. |
| `src/auth/db.ts` | Auth pool gets an `error` listener (pg idle-client shutdown notice, 57P01) — correct in prod, removes a test-teardown artifact. |

### Trust model (now)
- **Authentication:** the operator must present a valid Better Auth session.
- **Authorization:** the session user's email must be in `PLATFORM_OPERATOR_EMAILS` (env; empty = nobody can issue, fail-closed).
- **Identity:** token `sub` = the session user's real id (never free text).
- **Lifetime:** 15 minutes default.
- **Revocation:** per-`jti`, append-only, checked server-side on every use.
- **Audit:** every issuance + revocation is in an append-only ledger AND logged (no secret/cookie/password).

### Tests (integration, real PG + child processes)
- Issuance from an authenticated+authorized session → `sub` = session user id, `jti`, 15 min, audited.
- Issuance REFUSED for a non-allowlisted session; REFUSED without a session.
- **Revocation enforced on every use:** a revoked `jti` makes `manual-approval` fail closed; revocation audited.
- **Expired token fails closed** (15-min life).
- **Permission isolation:** unverified + unapproved (invited, pending) user has NO access to protected business functions (no active org → 401/403; not a member → `NOT_A_MEMBER`; invitation list strict; acceptance refused).
- **Approval-revocation effect:** revoking an approval does NOT auto-log-out the session or remove membership (it is a verification-status change, not a member/session revocation), but it reverts the acceptance gate so a new invitation can no longer be accepted.

### Execution proof (2026-11-25)
`tsc` 0 · `eslint` 0 · `vitest` **106/106, exit 0, 0 unhandled** · `next build` 0 (18 routes) · `pwa:guard` OK.
Secret scan of the pushed tip: no real secret in committed code.

## 12. CTO decision — approval revocation immediately blocks sensitive ops (2026-11-25)

**CTO decision:** automatic membership removal on approval revocation is REFUSED.
However, any revocation must **immediately** block protected business operations
when the approval is required — including for already-active sessions — with the
verification performed **server-side on every sensitive operation**. Session
revocation and membership removal remain **separate, deliberate** actions.

### Enforcement (server-side, every sensitive op)
`authorize()` — the single authorization entry point (ADR-0001) — now enforces an
approval-contingency check after membership is confirmed:
- A **non-owner** member who is **not email-verified** can only hold their seat
  because they accepted an invitation (which required a manual approval). Their
  access is therefore contingent on the approval still being in effect.
- If `!emailVerified && !manuallyApproved` → `authorize()` throws
  `APPROVAL_REVOKED` (403) on the very next operation — **immediately, for an
  active session** — without touching the membership row or the session.
- **Owners are exempt**: their seat comes from onboarding (not verification-gated,
  and owners are never invitable), so onboarding without verification still works.

### Tests (integration, real PG)
- **Immediate block on active session:** an unverified cashier (approved) can
  `cash.open`; after approval revocation, the very next `authorize(cash.open)`
  throws `APPROVAL_REVOKED`; membership + session are verified INTACT.
- **Onboarding carve-out:** an unverified owner (onboarded, not approved) can
  still run `org.settings.manage`.

### Execution proof (2026-11-25, cumulative)
`tsc` 0 · `eslint` 0 · `vitest` **108/108, exit 0, 0 unhandled** · `next build` 0
(18 routes) · `pwa:guard` OK · migration proof fresh+existing exit 0 (17 tables).
