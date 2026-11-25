import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
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
export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

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
