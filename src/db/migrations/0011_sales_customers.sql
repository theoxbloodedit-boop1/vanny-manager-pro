-- ADR-0029 — système de vente (point de vente) pour vendeurs et équipe
-- 1) clients (numéro WhatsApp + solde crédit)
-- 2) ventes (tickets) + articles
-- Toutes les tables sont tenant-scoped (org_id) via RLS (ADR-0001).

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  /** WhatsApp number (e.g. +243 978 508 099) — primary contact channel. */
  phone text,
  note text,
  /** Outstanding credit balance in minor units (cents / sous). */
  credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers_tenant" ON customers
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE UNIQUE INDEX IF NOT EXISTS customers_org_name_uq ON customers (org_id, name);
CREATE INDEX IF NOT EXISTS customers_org_idx ON customers (org_id);
CREATE INDEX IF NOT EXISTS customers_branch_idx ON customers (branch_id);

-- ---------------------------------------------------------------------------
-- Ventes (tickets)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  seller_member_id text NOT NULL,
  seller_name text,
  total_minor bigint NOT NULL,
  currency text NOT NULL CHECK (currency IN ('USD', 'CDF')),
  payment_method text NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'card', 'credit', 'transfer')),
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'voided', 'refunded')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_tenant" ON sales
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS sales_org_idx ON sales (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_branch_idx ON sales (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_customer_idx ON sales (customer_id);

-- ---------------------------------------------------------------------------
-- Articles de vente (snapshot du prix)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  name text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  unit_price_minor bigint NOT NULL,
  total_minor bigint NOT NULL
);

ALTER TABLE sales_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_items_tenant" ON sales_items
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS sales_items_sale_idx ON sales_items (sale_id);
