-- ADR-0022 — advanced business suite
-- 1) Product photos (products.image_url)
-- 2) Coffre-fort (vault): obligations (factures/loyer) + entries (dépôts/retraits/paiements)
-- 3) Multi-activité: nothing schema-side beyond what exists; the org
--    selector reads existing organizations/members.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_url text;

-- ---------------------------------------------------------------------------
-- Coffre-fort (vault)
-- ---------------------------------------------------------------------------

-- Obligations: recurring or one-off payables (facture, loyer, impôt).
-- The vault pays them gradually; each payment reduces the remaining amount.
CREATE TABLE IF NOT EXISTS vault_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense', 'rent', 'invoice', 'tax')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'CDF')),
  /** due date; null = no deadline */
  due_at timestamptz,
  paid_minor bigint NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'overdue')),
  note text,
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One vault per organization. The vault holds a running balance in the
-- org's base currency. Entries are append-only-ish: deposits, withdrawals,
-- and payments applied to an obligation.
CREATE TABLE IF NOT EXISTS vault_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('deposit', 'withdrawal', 'payment')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  /** currency: USD or CDF. Payments match the obligation currency. */
  currency text NOT NULL CHECK (currency IN ('USD', 'CDF')),
  /** obligation_id when kind = 'payment' (the obligation being settled). */
  obligation_id uuid REFERENCES vault_obligations(id) ON DELETE SET NULL,
  /** free note: "paiement loyer novembre", "caisse du jour", ... */
  note text,
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: tenant isolation for both vault tables (org_id).
ALTER TABLE vault_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_obligations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vault_entries_tenant" ON vault_entries
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);

CREATE POLICY "vault_obligations_tenant" ON vault_obligations
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);

CREATE INDEX IF NOT EXISTS vault_entries_org_idx ON vault_entries (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vault_obligations_org_idx ON vault_obligations (org_id, status, due_at);
