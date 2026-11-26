CREATE TYPE "public"."billing_event_action" AS ENUM('created', 'plan_changed', 'status_changed', 'seats_changed', 'amount_changed', 'period_renewed');--> statement-breakpoint
CREATE TYPE "public"."billing_interval" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."platform_access_action" AS ENUM('org_list', 'org_detail');--> statement-breakpoint
CREATE TYPE "public"."subscription_plan" AS ENUM('free', 'pro', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'suspended');--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subscription_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"action" "billing_event_action" NOT NULL,
	"operator_id" text NOT NULL,
	"reason" text NOT NULL,
	"previous_plan" text,
	"previous_status" text,
	"previous_seats" integer,
	"new_plan" text,
	"new_status" text,
	"new_seats" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_access_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operator_id" text NOT NULL,
	"action" "platform_access_action" NOT NULL,
	"org_id" uuid,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"plan" "subscription_plan" DEFAULT 'free' NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"interval" "billing_interval" DEFAULT 'monthly' NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_events_subscription_idx" ON "billing_events" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "billing_events_org_idx" ON "billing_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "billing_events_created_idx" ON "billing_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "platform_access_log_operator_idx" ON "platform_access_log" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "platform_access_log_org_idx" ON "platform_access_log" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "platform_access_log_created_idx" ON "platform_access_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_org_uq" ON "subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "subscriptions_plan_idx" ON "subscriptions" USING btree ("plan");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
-- ADR-0019: billing + platform-access ledgers are APPEND-ONLY at the database
-- level. No UPDATE/DELETE is possible for ANY role (including the schema
-- owner). Insert-only. Corrections are new rows, never mutations.
CREATE OR REPLACE FUNCTION prevent_billing_events_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'billing_events is append-only (ADR-0019)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER billing_events_append_only
  BEFORE UPDATE OR DELETE ON "billing_events"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_billing_events_mutation();--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_platform_access_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'platform_access_log is append-only (ADR-0019)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER platform_access_log_append_only
  BEFORE UPDATE OR DELETE ON "platform_access_log"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_platform_access_log_mutation();