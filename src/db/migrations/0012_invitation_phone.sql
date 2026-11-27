-- ADR-0032 — invitation par numéro WhatsApp
-- L'invitation peut désormais porter le numéro WhatsApp de l'invité (E.164),
-- afin qu'un compte WhatsApp (pas d'email réel) puisse accepter l'invitation
-- par correspondance téléphone.
-- Le matching email reste inchangé pour les comptes par email.

ALTER TABLE invitation ADD COLUMN IF NOT EXISTS phone text;

-- Index utile pour le matching par téléphone (un invité peut détenir des
-- invitations sur plusieurs organisations).
CREATE INDEX IF NOT EXISTS invitation_phone_idx ON invitation (phone);
