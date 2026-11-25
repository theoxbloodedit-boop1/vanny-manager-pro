CREATE TYPE "public"."business_sector" AS ENUM('boutique', 'bar', 'restaurant', 'salon', 'pharmacy');--> statement-breakpoint
CREATE TYPE "public"."cash_session_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('USD', 'CDF');--> statement-breakpoint
CREATE TYPE "public"."product_kind" AS ENUM('product', 'service');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('completed', 'voided', 'refunded');--> statement-breakpoint
CREATE TABLE "branch_access" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branch_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"business_sector" "business_sector" NOT NULL,
	"base_currency" "currency" DEFAULT 'USD' NOT NULL,
	"fx_rounding_step_cdf" integer DEFAULT 100 NOT NULL,
	"timezone" text DEFAULT 'Africa/Kinshasa' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_prices" (
	"product_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_prices_product_id_currency_pk" PRIMARY KEY("product_id","currency")
);
--> statement-breakpoint
ALTER TABLE "product_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"sku" text,
	"barcode" text,
	"kind" "product_kind" DEFAULT 'product' NOT NULL,
	"unit" text DEFAULT 'piece' NOT NULL,
	"track_expiry" boolean DEFAULT false NOT NULL,
	"batch_required" boolean DEFAULT false NOT NULL,
	"cost_usd_minor" bigint,
	"cost_cdf_minor" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_registers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_registers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"cashier_member_id" text NOT NULL,
	"status" "cash_session_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"opening_float_minor" bigint DEFAULT 0 NOT NULL,
	"expected_minor" bigint,
	"counted_minor" bigint,
	"variance_minor" bigint,
	"handover_from_session_id" uuid,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "cash_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"team_id" text,
	"inviter_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"branch_ids" text
);
--> statement-breakpoint
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" uuid,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branch_access" ADD CONSTRAINT "branch_access_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_access" ADD CONSTRAINT "branch_access_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_org_fk" FOREIGN KEY ("product_id","org_id") REFERENCES "public"."products"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_register_id_cash_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."cash_registers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_handover_from_session_id_cash_sessions_id_fk" FOREIGN KEY ("handover_from_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_organization_id_organizations_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branch_access_branch_user_uq" ON "branch_access" USING btree ("branch_id","user_id");--> statement-breakpoint
CREATE INDEX "branch_access_user_idx" ON "branch_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "branches_org_idx" ON "branches" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_org_name_uq" ON "branches" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_org_idx" ON "categories" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_org_name_uq" ON "categories" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "product_prices_product_idx" ON "product_prices" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_prices_org_idx" ON "product_prices" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_sku_uq" ON "products" USING btree ("org_id","sku");--> statement-breakpoint
CREATE INDEX "products_org_barcode_idx" ON "products" USING btree ("org_id","barcode");--> statement-breakpoint
CREATE INDEX "products_org_updated_idx" ON "products" USING btree ("org_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_registers_org_code_uq" ON "cash_registers" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "cash_registers_branch_idx" ON "cash_registers" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_session_open_uq" ON "cash_sessions" USING btree ("register_id","currency") WHERE "cash_sessions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "cash_session_branch_open_idx" ON "cash_sessions" USING btree ("branch_id","opened_at");--> statement-breakpoint
CREATE INDEX "cash_session_register_idx" ON "cash_sessions" USING btree ("register_id");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_org_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "members_org_user_uq" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "members_user_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "branch_access" AS PERMISSIVE FOR ALL TO public USING ("branch_access"."org_id" = current_setting('app.org_id', true)::uuid) WITH CHECK ("branch_access"."org_id" = current_setting('app.org_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "branches" AS PERMISSIVE FOR ALL TO public USING ("branches"."org_id" = current_setting('app.org_id', true)::uuid) WITH CHECK ("branches"."org_id" = current_setting('app.org_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "organizations" AS PERMISSIVE FOR ALL TO public USING ("organizations"."id" = current_setting('app.org_id', true)::uuid) WITH CHECK ("organizations"."id" = current_setting('app.org_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "categories" AS PERMISSIVE FOR ALL TO public USING ("categories"."org_id" = current_setting('app.org_id', true)::uuid) WITH CHECK ("categories"."org_id" = current_setting('app.org_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "product_prices" AS PERMISSIVE FOR ALL TO public USING ("product_prices"."org_id" = current_setting('app.org_id', true)::uuid) WITH CHECK ("product_prices"."org_id" = current_setting('app.org_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "products" AS PERMISSIVE FOR ALL TO public USING ("products"."org_id" = current_setting('app.org_id', true)::uuid) WITH CHECK ("products"."org_id" = current_setting('app.org_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cash_registers" AS PERMISSIVE FOR ALL TO public USING ("cash_registers"."org_id" = current_setting('app.org_id', true)::uuid) WITH CHECK ("cash_registers"."org_id" = current_setting('app.org_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cash_sessions" AS PERMISSIVE FOR ALL TO public USING ("cash_sessions"."org_id" = current_setting('app.org_id', true)::uuid) WITH CHECK ("cash_sessions"."org_id" = current_setting('app.org_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invitation" AS PERMISSIVE FOR ALL TO public USING ("invitation"."organization_id" = current_setting('app.org_id', true)::uuid) WITH CHECK ("invitation"."organization_id" = current_setting('app.org_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "member" AS PERMISSIVE FOR ALL TO public USING ("member"."organization_id" = current_setting('app.org_id', true)::uuid) WITH CHECK ("member"."organization_id" = current_setting('app.org_id', true)::uuid);