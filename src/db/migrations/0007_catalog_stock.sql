CREATE TYPE "public"."stock_movement_type" AS ENUM('purchase', 'adjustment', 'transfer_in', 'transfer_out', 'sale', 'return');--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"counterparty_branch_id" uuid,
	"type" "stock_movement_type" NOT NULL,
	"qty_delta" integer NOT NULL,
	"reference" text,
	"reason" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "low_stock_threshold" integer;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_org_fk" FOREIGN KEY ("product_id","org_id") REFERENCES "public"."products"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_org_branch_product_idx" ON "stock_movements" USING btree ("org_id","branch_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_movements_org_product_idx" ON "stock_movements" USING btree ("org_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_movements_org_created_idx" ON "stock_movements" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_movements" AS PERMISSIVE FOR ALL TO public USING ("stock_movements"."org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("stock_movements"."org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- ADR-0018 D7: accent/case-insensitive catalog search (unaccent is a standard
-- PG extension; created here so every environment that applies the migrations
-- has it — including production Neon).
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
-- ADR-0018: a zero-quantity movement is a bug, not an event.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_qty_nonzero" CHECK ("qty_delta" <> 0);--> statement-breakpoint
-- ADR-0004 / ADR-0018 D2: branch_stock is a PROJECTION (view), never the
-- source of truth. The invariant branch_stock(b,p) == SUM(qty_delta) holds by
-- construction; tests still prove it with an independent recomputation (T3).
--
-- security_invoker = true is MANDATORY (verified on PG 19, ADR-0018 D2 note):
-- a view runs by default with its OWNER's privileges, and the owner of
-- stock_movements bypasses RLS — an owner-owned view would therefore show
-- every tenant's stock to any caller with SELECT on the view. With
-- security_invoker the CALLER's RLS policy applies to the base table, so the
-- view fails closed exactly like the table does (proven in
-- tests/integration/phase2-stock.test.ts, AC-7).
CREATE VIEW "branch_stock" WITH (security_invoker = true) AS
SELECT m.org_id, m.branch_id, m.product_id, SUM(m.qty_delta) AS qty
FROM "stock_movements" m
GROUP BY m.org_id, m.branch_id, m.product_id;--> statement-breakpoint
-- ADR-0004: enforce append-only at the database level. No UPDATE/DELETE is
-- possible on the stock ledger for ANY role (including the schema owner).
-- Corrections are new `adjustment` documents (ADR-0018 D1).
CREATE OR REPLACE FUNCTION prevent_stock_movements_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only (ADR-0004)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER stock_movements_append_only
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_stock_movements_mutation();
