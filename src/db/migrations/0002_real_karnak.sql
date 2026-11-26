CREATE TABLE "operator_token_issuances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"jti" uuid NOT NULL,
	"operator_sub" text NOT NULL,
	"operator_email" text NOT NULL,
	"ttl_seconds" integer NOT NULL,
	"issued_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_token_revocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"jti" uuid NOT NULL,
	"revoker_sub" text NOT NULL,
	"reason" text NOT NULL,
	"revoked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "operator_token_issuances_sub_idx" ON "operator_token_issuances" USING btree ("operator_sub");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_token_issuances_jti_uq" ON "operator_token_issuances" USING btree ("jti");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_token_revocations_jti_uq" ON "operator_token_revocations" USING btree ("jti");
--> statement-breakpoint
-- ADR-0014 (CTO hardening): the operator-token issuance + revocation ledgers are
-- append-only. No UPDATE/DELETE for ANY role (trigger fires for every role).
CREATE OR REPLACE FUNCTION prevent_operator_token_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'operator token ledger is append-only (ADR-0014)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER operator_token_issuances_append_only
  BEFORE UPDATE OR DELETE ON "operator_token_issuances"
  FOR EACH ROW EXECUTE FUNCTION prevent_operator_token_ledger_mutation();--> statement-breakpoint
CREATE TRIGGER operator_token_revocations_append_only
  BEFORE UPDATE OR DELETE ON "operator_token_revocations"
  FOR EACH ROW EXECUTE FUNCTION prevent_operator_token_ledger_mutation();