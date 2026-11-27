import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";
import { tenantIsolationPolicy } from "./rls";

/**
 * IDENTITY — tables owned by Better Auth (ADR-0002, ADR-0012).
 *
 * These are PLATFORM tables, not tenant tables: a user belongs to N
 * organizations, so they cannot be RLS-scoped by org. They are accessed only
 * through the Better Auth instance (which connects with the schema-owner role)
 * or through tenant-scoped views of `member`/`invitation` below, which ARE
 * RLS-protected.
 *
 * Ids are `text`: Better Auth generates them (cuid-style) unless a hook
 * supplies one (we supply UUIDv7 for organizations — see src/auth/index.ts).
 */
export const users = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    /**
     * ADR-0016: E.164 phone number for phone (WhatsApp) sign-ups, e.g.
     * "+243971234567". NULL for email accounts. The unique index makes the
     * phone the single source of truth for account deduplication (the
     * deterministic virtual email in `email` is derived from it).
     */
    phone: text("phone"),
    emailVerified: boolean("email_verified").notNull().default(false),
    /**
     * ADR-0014: distinct from `emailVerified`. A manual approval means "an
     * operator approved this user to join" — it NEVER means the email address
     * was verified, and it is never written by the email-verification flow.
     * Set ONLY by the audited manual-approval flow (single transaction with
     * `manual_approvals`). Grants no organization access by itself; it lets
     * the user satisfy the verification gates (invitation acceptance,
     * onboarding). For phone accounts (ADR-0016) it is THE trust anchor.
     */
    manuallyApproved: boolean("manually_approved").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("user_phone_uq").on(t.phone)],
);

export const sessions = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Organization plugin: the organization active FOR THIS SESSION
    // (session.session.activeOrganizationId). SET NULL: deleting the
    // organization must not invalidate sessions that belong to other orgs.
    activeOrganizationId: uuid("active_organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/**
 * TENANCY MEMBERSHIP — `member` and `invitation` ARE tenant data (they carry
 * organization_id), so they get RLS like every other tenant table.
 *
 * `organizationId` is a `uuid` column (not text) because it references
 * `organizations.id`, and PostgreSQL FKs require matching types. Better Auth
 * passes the id as a string either way.
 */
export const members = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Comma-separated role codes ("owner" | "owner,admin" | ...). */
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("members_org_user_uq").on(t.organizationId, t.userId),
    index("members_user_idx").on(t.userId),
    tenantIsolationPolicy(t.organizationId),
  ],
).enableRLS();

export const invitations = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /**
     * ADR-0032: invitee's WhatsApp number in E.164 (e.g. "+243971234567").
     * Optional. When present, a phone account registering with this number
     * can accept the invitation by phone match (email accounts match by
     * email as before). NULL when only an email was provided.
     */
    phone: text("phone"),
    role: text("role").notNull(),
    status: text("status").notNull().default("pending"),
    teamId: text("team_id"),
    inviterId: text("inviter_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    /**
     * JSON array of branch ids granted to the invitee, materialized into
     * `branch_access` when the invitation is accepted (afterAddMember hook).
     * Carried as a Better Auth organization-plugin additional field.
     */
    branchIds: text("branch_ids"),
  },
  (t) => [
    index("invitation_org_idx").on(t.organizationId),
    index("invitation_email_idx").on(t.email),
    tenantIsolationPolicy(t.organizationId),
  ],
).enableRLS();

/**
 * ADR-0014 — MANUAL-APPROVAL AUDIT (platform table, NOT tenant-scoped).
 *
 * Append-only ledger of manual approval/revocation operations. Enforced
 * append-only by a DB trigger (see migration) so no UPDATE/DELETE is possible
 * for any role. Written ONLY by the audited manual-approval flow (CLI script
 * with a verified operator token, or the in-app operator dashboard whose
 * identity is the authenticated operator session — ADR-0016), always in the
 * same transaction as the `user.manually_approved` update.
 *
 * `operatorId` is the REAL operator identifier (token `sub`, or session user
 * id) from an authenticated execution context — never a freely-typed argument.
 */
export const manualApprovals = pgTable(
  "manual_approvals",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Verified operator identifier (subject of the verified operator token). */
    operatorId: text("operator_id").notNull(),
    /** "approve" | "revoke". */
    action: text("action").notNull(),
    /** Mandatory reason for the operation. */
    reason: text("reason").notNull(),
    /** Unique identifier of this operation (correlates status + audit). */
    operationId: uuid("operation_id").notNull(),
    /** UTC timestamp of the operation. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("manual_approvals_user_idx").on(t.userId),
    uniqueIndex("manual_approvals_operation_uq").on(t.operationId),
  ],
);

/**
 * ADR-0014 (CTO hardening) — OPERATOR-TOKEN ISSUANCE AUDIT (platform, NOT RLS).
 *
 * Append-only record of every platform-operator token that was minted. Issuance
 * is tied to an AUTHENTICATED + AUTHORIZED platform-operator session (the `sub`
 * is the session user's real id, never free text), so this ledger ties each
 * token's `jti` to the human/operator identity that caused it to be issued.
 */
export const operatorTokenIssuances = pgTable(
  "operator_token_issuances",
  {
    id: uuid("id").primaryKey(),
    /** Unique token id (token `jti` claim). */
    jti: uuid("jti").notNull(),
    /** The authenticated operator's real identifier (session user id). */
    operatorSub: text("operator_sub").notNull(),
    /** The operator's email at issuance (for the audit trail). */
    operatorEmail: text("operator_email").notNull(),
    /** Lifetime of the token in seconds (15 min default). */
    ttlSeconds: integer("ttl_seconds").notNull(),
    /** UTC timestamp of issuance. */
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("operator_token_issuances_sub_idx").on(t.operatorSub),
    uniqueIndex("operator_token_issuances_jti_uq").on(t.jti),
  ],
);

/**
 * ADR-0014 (CTO hardening) — OPERATOR-TOKEN REVOCATION AUDIT (platform, NOT RLS).
 *
 * Append-only denylist. A revoked `jti` is refused on EVERY use (checked
 * server-side in the verification path). Every revocation is recorded with the
 * revoking operator, a mandatory reason, and the UTC timestamp.
 */
export const operatorTokenRevocations = pgTable(
  "operator_token_revocations",
  {
    id: uuid("id").primaryKey(),
    /** The token id being revoked (token `jti` claim). */
    jti: uuid("jti").notNull(),
    /** The authenticated operator who revoked it. */
    revokerSub: text("revoker_sub").notNull(),
    /** Mandatory reason for the revocation. */
    reason: text("reason").notNull(),
    /** UTC timestamp of revocation. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("operator_token_revocations_jti_uq").on(t.jti),
  ],
);
