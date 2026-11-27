-- ADR — Sections manquantes du tableau de bord propriétaire
-- 1) dépenses (sorties d'argent hors caisse)
-- 2) fournisseurs (partenaires d'achat)
-- 3) appareils (registry de synchronisation, ADR-0007)
-- 4) journal d'activité (audit tenant, append-only)
-- Toutes les tables sont tenant-scoped (org_id) via RLS (ADR-0001).

-- ---------------------------------------------------------------------------
-- Dépenses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'autres',
  label text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'CDF')),
  note text,
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expenses_tenant" ON expenses
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS expenses_org_idx ON expenses (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS expenses_branch_idx ON expenses (branch_id);

-- ---------------------------------------------------------------------------
-- Fournisseurs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  note text,
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suppliers_tenant" ON suppliers
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_name_uq ON suppliers (org_id, name);
CREATE INDEX IF NOT EXISTS suppliers_org_idx ON suppliers (org_id);

-- ---------------------------------------------------------------------------
-- Appareils (device registry — ADR-0007)
-- Registre des appareils de vente/synchronisation. La sync authentifie
-- appareil + membre. Un appareil révoqué est bloqué au prochain push/pull.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  member_id text REFERENCES "member"(id) ON DELETE CASCADE,
  label text NOT NULL,
  platform text NOT NULL DEFAULT 'web',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "devices_tenant" ON devices
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS devices_org_idx ON devices (org_id, last_seen_at DESC);

-- ---------------------------------------------------------------------------
-- Journal d'activité tenant (audit, append-only)
-- Traçabilité des actions métier importantes (vente, caisse, etc.).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id text,
  actor_name text,
  action text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity_log_tenant" ON activity_log
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS activity_log_org_idx ON activity_log (org_id, created_at DESC);
