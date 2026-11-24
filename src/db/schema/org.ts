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
    businessSector: businessSectorEnum("business_sector").notNull(),
    baseCurrency: currencyEnum("base_currency").notNull().default("USD"),
    /** CDF has no sub-unit in practice; merchants round change to 50 or 100. */
    fxRoundingStepCdf: integer("fx_rounding_step_cdf").notNull().default(100),
    timezone: text("timezone").notNull().default("Africa/Kinshasa"),
    status: text("status").notNull().default("active"),
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
