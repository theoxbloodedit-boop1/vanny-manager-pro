# ADR-0018 — Phase 2 : catalogue, mouvements de stock append-only et stock dérivé

- **Statut** : ACCEPTÉE (GO propriétaire 2026-11-26, Phases 2-5) · **Branche** : `feat/phase2-catalog-stock`
- **Dépend** de : ADR-0004 (registres append-only), ADR-0005 (prix normalisés par devise), ADR-0001 (RLS)
- **Périmètre** : ROADMAP Phase 2 (2.1–2.7), sans les ventes (Phase 3).

## 1. Décisions

### D1 — `stock_movements` : registre append-only, corrigé par document

Conformément à ADR-0004 : la table n'est **jamais UPDATE/DELETE** ni par le code
ni par la base (trigger `BEFORE UPDATE OR DELETE` → exception, style
`manual_approvals`). Une erreur de stock = **nouveau mouvement `adjustment`**
(motif obligatoire), jamais une édition.

Colonnes : `id` (UUIDv7, ADR-0003) · `org_id` · `branch_id` · `product_id`
(FK composite `(product_id, org_id) → products(id, org_id)`) · `type`
(`purchase | adjustment | transfer_in | transfer_out | sale | return`) ·
`qty_delta` (entier signé, **≠ 0** par contrainte CHECK) ·
`counterparty_branch_id` (transferts uniquement) · `reference` (ex. « achat
réf. #12 », lien Phase 3) · `reason` (obligatoire pour `adjustment`) ·
`created_by_id` · `created_at`.

Types servis par la Phase 2 : `purchase`, `adjustment`, `transfer_in`,
`transfer_out`. `sale`/`return` existent dans l'enum mais ne sont écrits que par
la Phase 3 (le POS) — l'enum est figé maintenant pour éviter toute migration
future du registre.

### D2 — `branch_stock` : **vue SQL**, pas table matérialisée (réaffinement ADR-0004)

ADR-0004 dit « projection matérialisée, jamais source de vérité ». Une **vue**
renforce cette propriété de façon stricte : il n'existe **aucune écriture** vers
`branch_stock`, donc **aucun chemin de drift**. L'invariant
`branch_stock(b, p) == Σ stock_movements(b, p).qty_delta` tient **par
construction** ; le test T3 le prouve quand même en recomputant le stock par
une SQL **indépendante** de la définition de la vue (détection d'erreur de
définition de la vue).

```sql
CREATE VIEW branch_stock WITH (security_invoker = true) AS
SELECT m.org_id, m.branch_id, m.product_id, SUM(m.qty_delta) AS qty
FROM stock_movements m GROUP BY 1, 2, 3;
```

**Note sécurité (vérifiée sur PG 19.0, 2026-11-26)** — `security_invoker = true`
est **obligatoire** sur cette vue. Une vue Postgres s'exécute par défaut avec
les privilèges de son **propriétaire**, et le propriétaire de `stock_movements`
bypasse le RLS : une vue possédée par le propriétaire du schéma montrait les
stocks de **tous** les tenants à n'importe quel appelant ayant `SELECT` sur la
vue (reproduit et prouvé par test : tenant B voyait les lignes du tenant A).
Avec `security_invoker`, la **politique RLS de l'appelant** s'applique à la
table de base : la vue échoue fermé comme la table (AC-7 le prouve). Règle
d'équipe à retenir : **aucune vue posant sur une table tenant-scopée ne peut
être créée sans `security_invoker = true`**, et les lectures de stock
n'utilisent jamais la vue hors d'un contexte tenant (`withTenantDb`) — le
filtre `org_id` explicite dans `inventory.ts` en est la redondance défensive.

### D3 — Transfert atomique : une transaction, deux écritures, zéro état intermédiaire

`transfer(from, to, product, qty)` = **un seul `db.transaction`** : vérification
du stock source → insertion `transfer_out` (−qty, counterparty = to) →
insertion `transfer_in` (+qty, counterparty = from). Tout échec (contrainte,
stock insuffisant, FK) → ROLLBACK total : les deux succursales sont mises à
jour ensemble, ou aucune (Gate 2). Le test force l'échec sur la 2e écriture
pour prouver le rollback.

### D4 — Stock insuffisant : refus explicite ; les services ne touchent jamais le stock

- `kind = service` → **tout** mouvement est refusé (409 `SERVICE_NO_STOCK`) —
  « les services ne touchent pas le stock » (catalog, ADR-0005).
- `kind = product` : tout mouvement qui ferait le stock de la succursale
  négatif est refusé (409 `INSUFFICIENT_STOCK`) — achat positif impossible à
  refuser ; ajustement négatif / sortie transfer : stock courant vérifié dans
  la même transaction (lecture `branch_stock` post-verrouillage de ligne via
  l'insertion).

### D5 — Prix : au moins une devise à la création, **jamais de conversion silencieuse**

Réconciliation ADR-0005 (un produit peut être légitimement USD-seul ou
CDF-seul) et Gate 2 (« un produit sans prix dans l'une des devises est refusé
à l'écriture ») :

- **À la création** : au moins **un** prix (USD ou CDF), les deux possibles,
  indépendants (ni dérivé, ni taux).
- **À la mise à jour** : on peut changer le prix d'une devise ; après mise à
  jour, le produit doit toujours en avoir au moins un (on ne peut pas
  supprimer le dernier prix — le désactiver ou le repricer).
- **À la vente (Phase 3)** : vendre un produit dans une devise où il n'a pas
  de prix = **refus explicite** (pas de conversion silencieuse) — c'est la
  lecture opérationnelle du Gate 2, identique à la ligne Gate 3 « un produit
  prixé dans une seule devise ne peut pas être converti silencieusement ».

### D6 — Seuil de stock bas : une colonne `low_stock_threshold` sur `products`

`NULL` = aucune alerte. Le calcul « en stock bas » est dérivé
(`branch_stock.qty < threshold` par succursale), jamais stocké.

### D7 — Recherche v1 : `unaccent` + `ILIKE` scopé à l'org (pg_trgm réservé)

Extension `unaccent` créée en 0007. La recherche porte sur
`name`/`sku`/`barcode`, insensible aux accents et à la casse, **dans
l'organisation active** (RLS + filtre org) : à l'échelle visée (10k produits
répartis sur des dizaines d'orgs), le scan scopé passe très sous la cible
Gate 2 de 150 ms ; le test le mesure. `pg_trgm` (similarité) sera ajouté en
optimisation sans changer l'API.

### D8 — Suppression de produit : interdite s'il a des mouvements

`DELETE /api/products/[id]` = 409 si le produit a au moins un
`stock_movements` (l'historique doit rester lisible) ; sinon suppression
cascade (prix avec). Le chemin normal est la **désactivation**
(`is_active = false`), visible dans l'UI — cohérent avec la pédagogie
ADR-0004 (« le bouton édition d'une vente doit ouvrir un flux de
contre-passation, pas un formulaire »).

## 2. Surface

| Fichier | Rôle |
|---|---|
| `src/db/schema/catalog.ts` | + `lowStockThreshold` sur products ; + table `stock_movements` |
| `src/db/migrations/0007_*.sql` | drizzle (colonne + table + enum) + manuel : `CREATE EXTENSION unaccent`, vue `branch_stock`, trigger append-only, index |
| `src/server/catalog.ts` | catégories + produits (zod, `authorize()`, RLS-scopé) |
| `src/server/inventory.ts` | mouvements (purchase/adjustment/transfer atomique), stock, alertes |
| `src/app/api/categories/**`, `src/app/api/products/**`, `src/app/api/stock/**` | routes |
| `src/app/admin/page.tsx` | cartes « Catalogue » + « Stock » |
| `tests/integration/phase2-stock.test.ts` | T3 + atomicité + refus + recherche + trigger + RLS |
| `tests/unit/ledger-grep.test.ts` | garde-fou ADR-0004 : zéro `.update(`/.delete(` sur les registres dans le code feature |

## 3. Critères d'acceptation (Gate 2, opérationnels)

- **AC-1 (T3)** : après chacun des types de mutation (purchase, adjustment ±,
  transfer, [sale/return = Phase 3]), `branch_stock` (vue) == recomputation
  indépendante par SQL brute — sur les deux succursales du transfert.
- **AC-2** : transfert dont la 2e écriture échoue → **aucune** des deux lignes
  n'existe (rollback prouvé).
- **AC-3** : sortie (transfer_out/adjustment −) rendant le stock négatif →
  409 `INSUFFICIENT_STOCK`, stock inchangé ; service → 409 `SERVICE_NO_STOCK`.
- **AC-4** : création produit sans aucun prix → 400 ; mise à jour supprimant
  le dernier prix → 400 ; prix USD et CDF indépendants (aucune dérivation).
- **AC-5** : recherche « café » trouve « Café » et « cafe » ; mesurée < 150 ms
  sur 10k produits de l'org de test.
- **AC-6** : `UPDATE`/`DELETE` directs sur `stock_movements` (rôle owner) →
  exception du trigger ; le grep de code ne trouve aucune écriture de
  mutation sur les registres.
- **AC-7** : tenant B ne lit ni n'écrit les produits/mouvements du tenant A
  (RLS, via `withTenantDb`).
- **AC-8** : gates complets verts (tsc, eslint, tests, build, PWA).

## 4. Risques & réponses

| Risque | Réponse |
|---|---|
| Concurrency : deux transferts simultanés sur le même produit | Vérification du stock + écritures dans la même transaction ; les verrous de ligne Postgres sérialisent les conflits — test dédié (deux transactions parallèles, une doit échouer si stock = 1 et les deux tentent 1). |
| La vue ralentit à grande échelle | Index `(org, branch, product)` et `(org, product)` ; à l'échelle v1 c'est négligeable ; materialization possible plus tard sans changer l'API. |
| `unaccent` indisponible sur la cible | Extension PostgreSQL standard, créée par la migration 0007 (Neon : autorisée). |
| Pédagogie « pas d'édition » mal comprise par l'UI | L'UI n'expose aucun bouton d'édition de mouvement ; l'ajustement s'ouvre avec un motif obligatoire (consigné). |
