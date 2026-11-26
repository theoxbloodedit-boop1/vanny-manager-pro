CREATE TABLE "manual_approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"operator_id" text NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "manually_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "manual_approvals" ADD CONSTRAINT "manual_approvals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manual_approvals_user_idx" ON "manual_approvals" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_approvals_operation_uq" ON "manual_approvals" USING btree ("operation_id");--> statement-breakpoint
-- ADR-0014: enforce append-only at the database level. No UPDATE/DELETE is
-- possible on the manual-approval audit ledger for ANY role (including the
-- schema owner). Insert-only.
CREATE OR REPLACE FUNCTION prevent_manual_approvals_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'manual_approvals is append-only (ADR-0014)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER manual_approvals_append_only
  BEFORE UPDATE OR DELETE ON "manual_approvals"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_manual_approvals_mutation();