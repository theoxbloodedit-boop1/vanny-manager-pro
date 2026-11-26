# ADR-0017 — Lien d'invitation partagé via WhatsApp + validation opérateur des comptes email

- **Statut** : ACCEPTÉE (décision propriétaire 2026-11-26) · **Branche** : `feat/invite-whatsapp`
- **Dépend** de : ADR-0014 (flux d'approbation audité), ADR-0016 (compte opérateur)
- **Périmètre** : (A) partage du lien d'invitation sur WhatsApp — option « gratuite » ;
  (B) extension du dashboard opérateur aux comptes **email** en attente de validation.

## 1. Contexte

Le canal d'invitation natif est l'email (plugin Better Auth), mais au marché cible
(CD) le canal réel est WhatsApp, et l'email de livraison dépend de Resend
(3 envs Vercel non encore configurées). Trois besoins concrets :

1. L'invité doit pouvoir recevoir **un lien** partageable (pas seulement un mail).
2. L'invité doit arriver **déjà orienté** (email pré-rempli, contexte « vous avez
   été invité·e »).
3. Sans Resend, un compte **email** fraîchement créé reste bloqué au mur
   « Vérifiez votre adresse email » et ne peut pas accepter l'invitation — alors
   que le flux WhatsApp dispose déjà d'une issue de secours (validation opérateur).

## 2. Décisions

### D1 — Le lien partagé est la page d'auth pré-remplie : `/auth?email=<email>`

Aucun token dans l'URL, aucun endpoint public nouveau. **L'identité de
l'invitation EST l'email** — exactement ce que l'email d'invitation révèle
déjà. La sécurité de l'acceptation reste intégralement portée par :

- le plugin organizations Better Auth (adéquation email invité ↔ compte,
  unicité, expiration) ;
- notre porte d'acceptation (ADR-0014) : `emailVerified OR manuallyApproved`.

Le lien est construit côté client avec `window.location.origin` : il pointe
toujours vers le déploiement qui le partage — cohérent avec le fix de base URL
(commit `3c5fdc4`, `VERCEL_URL`).

### D2 — Livraison = deep link `wa.me` (option A, coût zéro)

`https://wa.me/<E.164>?text=<message>` ouvre le WhatsApp de l'**invitateur**
avec le message pré-rempli ; il appuie sur envoyer. Aucune API, aucun compte
Meta, aucun template approuvé, aucun coût par message. L'envoi automatique
serveur (WhatsApp Business API) est explicitement **hors périmètre** —
revoir si le volume le justifie.

### D3 — Normalisation du numéro : convention RDC documentée

`+243…` / `243…` / `+243 …` passés tels quels ; `0` + 9 chiffres → `243`
(mobiles RDC locaux) ; `00…` → préfixe international. Rejet : 8–15 chiffres
(E.164) exigés, tout ce qui commence encore par `0` après réécriture est
refusé. Implémenté dans `src/server/invite-link.ts` (module pur, testé),
réutilisable par la suite (ex. : exports, sync).

### D4 — Le numéro de l'invité n'est PAS persisté

La table `invitation` appartient au plugin Better Auth ; aucune migration pour
ce champ. Le numéro est saisi soit au moment de la création (champ optionnel
du formulaire), soit au moment du partage (panneau sous l'invitation en
attente). Pas de PII de plus dans la base, zéro schéma à migrer.

### D5 — Extension opérateur : les comptes email en attente sont validables

`listPhoneApprovals` renvoie en plus `pendingEmail` (comptes sans numéro,
non vérifiés, non approuvés) et `recent` couvre désormais les deux types.
`operatorApplyApproval` accepte `{ phone | email, action, reason }` (exactement
un des deux) et réutilise **le même flux audité ADR-0014** (drapeau + ligne
append-only, une transaction). `emailVerified` n'est jamais touché.

C'est l'issue de secours de production tant que Resend n'est pas configuré :
l'invité reçoit le lien WhatsApp → crée son compte → **l'opérateur le valide**
→ il peut accepter l'invitation. Avec Resend configuré, le lien de
vérification classique reprend le relais (les deux chemins coexistent).

## 3. Surface

| Fichier | Rôle |
|---|---|
| `src/server/invite-link.ts` | module pur : `normalizeWaPhone`, `buildInviteAppUrl`, `buildInviteMessage`, `buildWhatsAppUrl` |
| `tests/unit/invite-link.test.ts` | 12 tests unitaires |
| `src/app/auth/page.tsx` | `?email=` → bannière « Vous avez été invité·e » + inscription pré-remplie |
| `src/app/admin/page.tsx` | champ téléphone optionnel + panneau de partage (formulaire et liste en attente) + `ShareInviteControls` |
| `src/server/phone-auth.ts` | `pendingEmail`, `recent` deux types, approbation par email |
| `src/app/operator/page.tsx` | carte « En attente de validation — email » + révocation généralisée |

## 4. Critères d'acceptation

- **AC-1** : depuis le dashboard, « WhatsApp » sur une invitation en attente
  ouvre `wa.me/<E.164>` avec un message contenant le nom de l'org, l'email
  invité et le lien `/auth?email=` de **ce** déploiement.
- **AC-2** : l'invité qui ouvre le lien atterrit en mode inscription avec
  l'email pré-rempli et la bannière de contexte ; créer un compte avec cet
  email fait apparaître l'invitation à `/post-auth` (flux existant).
- **AC-3** : normalisation — `0978508099` → `243978508099` ; `+243 978 508 099`
  inchangé ; entrées invalides → bouton désactivé (aucun `wa.me` partiel).
- **AC-4** : un compte email non vérifié apparaît dans `pendingEmail` ;
  « Valider » (motif obligatoire) passe la porte d'acceptation de
  l'invitation ; action réversible par « Révoquer » ; chaque action produit
  sa ligne d'audit append-only. Non-opérateur → 403 (inchangé).
- **AC-5** : `tsc`, `eslint`, tests unitaires + intégration existants verts ;
  build prod vert.

## 5. Risques & réponses

| Risque | Réponse |
|---|---|
| L'invité n'a pas de WhatsApp (email seulement) | Le formulaire d'invitation reste email-first ; le champ téléphone est optionnel — l'invitation par email (Resend) ou le lien copié-collé restent possibles. |
| Numéro saisi au mauvais format | Normalisation stricte + bouton désactivé tant que le E.164 n'est pas valide ; la convention `0`→`243` est documentée (D3). |
| L'opérateur valide un intrus | Même niveau de confiance que le flux WhatsApp existant (ADR-0016) : l'opérateur doit confirmer l'identité (appel/email) — le motif est consigné dans l'audit. |
| Fuite d'info via le lien | Le lien ne porte que l'email de l'invité (déjà public dans l'email d'invitation) ; aucune donnée tenant, aucun token. |
