import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { businessSectorEnum, currencyEnum } from "./enums";
import { tenantIsolationPolicy } from "./rls";

/**
 * Organizations are managed by Better Auth's organization plugin (ADR-0002).
 * This table holds the *business* attributes that Better Auth does not:
 * Better Auth owns identity, membership and roles; we own the business profile.
 *
 * It is tenant-scoped by its own primary key, not by an `org_id` column.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    /** Better Auth fields (written by the organization plugin). */
    logo: text("logo"),
    metadata: text("metadata"), // JSON string, managed by Better Auth
    businessSector: businessSectorEnum("business_sector").notNull(),
    baseCurrency: currencyEnum("base_currency").notNull().default("USD"),
    /** CDF has no sub-unit in practice; merchants round change to 50 or 100. */
    fxRoundingStepCdf: integer("fx_rounding_step_cdf").notNull().default(100),
    timezone: text("timezone").notNull().default("Africa/Kinshasa"),
    status: text("status").notNull().default("active"),
    /**
     * ADR-0015 — tenant theming: id of a tone from the STATIC catalog
     * (src/themes/themes.ts). NULL = neutral (current UI). No SQL CHECK on
     * purpose: the catalog evolves in code, so validation is app-side and
     * fail-closed (unknown value → neutral render, never a 500).
     */
    themeId: text("theme_id"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("organizations_slug_idx").on(t.slug),
    tenantIsolationPolicy(t.id),
  ],
).enableRLS();

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),
    phone: text("phone"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("branches_org_idx").on(t.orgId),
    uniqueIndex("branches_org_name_uq").on(t.orgId, t.name),
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();

/**
 * Branch-level access grant: which user may operate at which branch.
 *
 * The ORG-LEVEL role (owner/admin/manager/cashier/...) lives in Better Auth's
 * `member` table. This table answers a different question: "is this person
 * allowed to work AT this branch?" A cashier with no row here for branch B
 * gets a 403, not an empty list (Gate 1, ADR-0001).
 *
 * `userId` references the Better Auth `user` table (text id), so this table
 * has no typed FK to it (cross-schema string) — integrity is enforced in the
 * service layer and covered by tests.
 */
export const branchAccess = pgTable(
  "branch_access",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    grantedBy: text("granted_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("branch_access_branch_user_uq").on(t.branchId, t.userId),
    index("branch_access_user_idx").on(t.userId),
    tenantIsolationPolicy(t.orgId),
  ],
).enableRLS();
