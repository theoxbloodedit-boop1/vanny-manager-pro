-- ADR-0020 — TENANT BRANDING & ADVANCED CATALOGUE (Phase 6.2+)
-- Adds per-organization branding (name, logo, accent color) so each tenant
-- can personalise its space beyond the static theme catalog, and unlocks the
-- advanced catalogue/invitation/dashboard work.

-- ---- Branding on organizations -------------------------------------------
-- brand_name   : display name shown in the tenant's header / login (defaults
--                to the org name when null).
-- logo_url     : data URL (base64) of the tenant logo, shown in the header
--                and login. Kept small; validated app-side (max size, image
--                type). NULL = no logo (use the VANNY mark).
-- brand_color  : hex accent override (e.g. "#0b5cff"). NULL = use the
--                theme's accent. Validated app-side (#RRGGBB).
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "brand_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "logo_url" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "brand_color" text;--> statement-breakpoint

-- ---- Advanced catalogue: product cost + tax-free flag -------------------
-- cost_usd_minor / cost_cdf_minor already exist (internal cost basis). Add a
-- margin/tax-free toggle so the advanced catalogue can model tax-exempt
-- products (pharmacy/agro) without a separate schema.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tax_free" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- ---- Invitation: make branch grants optional ---------------------------
-- The invitation `branch_ids` additional field is a JSON array. Previously the
-- service required >= 1 branch. We keep the column but the service now allows
-- an empty array (invite to the org with no branch access yet). No schema
-- change needed here — the additional field is a text column.

-- ---- Category ordering (advanced catalogue) -----------------------------
-- Explicit display order for categories (lower = first). NULL = unordered.
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "icon" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "color" text;--> statement-breakpoint

-- Index for ordered category listing.
CREATE INDEX IF NOT EXISTS "categories_org_sort_idx" ON "categories" USING btree ("org_id", "sort_order");
