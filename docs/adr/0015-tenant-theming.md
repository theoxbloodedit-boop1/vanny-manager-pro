# ADR-0015 — Theming par tenant : catalogue de 12 tons

- **Statut** : ACCEPTÉE — décision propriétaire 2026-11-26 (« GO sur les tons ») ; **implémentée** le 2026-11-26 (branche `feat/tenant-theming`, commit à venir). Écarts documentés vs brouillon : ① migration = **0006** (0005 ayant été pris par ADR-0016) ; ② écriture réservée au **owner** (permission existante `org.settings.manage`, owner-only dans la matrice — plus strict que « ADMIN/OWNER » du brouillon) ; ③ le mode clair/sombre est une **préférence par appareil** (localStorage), pas une colonne ; ④ application = override des variables CSS sur `<html>` depuis `src/themes/themes.ts` (source unique, zéro CSS par ton dans globals.css).
- **Dépend** de : ADR-0014 (multi-tenant + RLS + better-auth) — branchée sur `main` après merge, branche dédiée `feat/tenant-theming`.
- **Périmètre** : nouveau module UI/config **v1** = le choix du ton par organisation, appliqué au dashboard + page auth du tenant.

## 1. Contexte

L'owner souhaite que chaque activité cliente de Vanny Manager Pro puisse choisir son « ton » visuel parmi un catalogue de maquettes (32 références fournies, 2026-11-25/26 → `/home/user/uploads/`). Les références couvrent : restauration (RIN, HANSIK, Washl, Eat Up, Spice×3), e-com (Nexora, TechVerse, DealKart, Stride, Power Perform, Sportify, Vital Gym), food mobile (Baya, Taco Bell, QuickB sombre/clair), fitness (Pulse, FitZone, Mellow, Q, UI Kit), premium B2B (Velaro, Escape Box), nature (Poulls, Blockfolio, Namibia). 2 assets sont des chartes de brand (ideawave, poster 3D) → bibliothèque de visuels, **pas** des tons.

## 2. Décisions

### D1 — Un moteur de tokens, zéro branche de code par ton
Le UI consomme uniquement des **variables CSS** (aucune couleur/typo hardcodée dans les composants). Chaque ton = un jeu de tokens ; le rendu choisit le jeu via `<html data-theme data-mode>`. Aucune condition `if (theme === …)` dans le code applicatif.

### D2 — Catalogue statique versionné : 12 tons × 2 modes
`src/themes/themes.ts` : 12 tons, chacun avec ses jeux **sombre ET clair** (démontré nécessaire par la paire QuickBite) :

| # | `theme_id` | Palette (sombre) | Sources |
|---|---|---|---|
| 1 | `midnight-rose` | noir · magenta/rose | RIN, FitZone |
| 2 | `ember-noir` | noir · orange | Velaro, ClimbLab, Washl, Baya |
| 3 | `crimson` | noir · rouge | Power Perform, Escape Box, SpiceCraft |
| 4 | `violet-pulse` | noir · violet · lime | Pulse, Mellow, QuickB sombre |
| 5 | `citron-studio` | noir · jaune/lime | Q Fitness, Gym UI Kit, Stride |
| 6 | `or-atelier` | gris foncé · or | Vital Gym, HANSIK |
| 7 | `blanc-flag` | blanc · orange | Nexora, Eat Up, Blockfolio |
| 8 | `blanc-signal` | blanc · bleu | QuickB clair, TechVerse |
| 9 | `nature-verte` | crème · vert | Poulls, Sportify |
| 10 | `creme-live` | crème · violet multi | Taco Bell, Namibia |
| 11 | `violet-market` | clair · violet | DealKart, SpiceWave |
| 12 | `marche-orne` | sombre chaud · accents riches | SpiceBazaar, SpiceCraft |

Tokens par mode : `bg, surface, text, textMuted, accent, accentContrast, border, success, warning, danger` + `fontDisplay, fontBody, radius, buttonStyle`. **24 skins au total.**

### D3 — Persistance : 1 colonne, pas de nouvelle table
Migration **0006** (brouillon : 0004, réaffectée à 0006 car 0005 = ADR-0016) : `ALTER TABLE organizations ADD COLUMN theme_id text NULL;`
- `NULL` = **ton neutre actuel** (UI inchangée → risque visuel nul au rollout, pas de valeur par défaut forcée).
- Pas de `CHECK` SQL (le catalogue évolue en code) : validation **app-side** + **fail-closed** (valeur inconnue → rendu neutre, jamais d'erreur 500).

### D4 — Accès : pas de nouvelle surface publique
- Lecture : `theme_id` lu avec la row `organizations` de l'org active (session) — la politique RLS existante sur `organizations` suffit ; **aucune nouvelle table ⇒ aucune nouvelle policy**.
- Écriture : `PATCH /api/org/theme { "themeId": "ember-noir" }` — derrière `authorize()` **rôle ADMIN/OWNER de l'org uniquement**, validation du catalog, 403 sinon. Pas de GET dédié (la config part avec la page).

### D5 — Isolation (garde-fou central, même standard que ADR-0014)
Le ton est un **identifiant d'un enum statique** : il ne porte aucune donnée tenant. Le risque de fuite inter-tenant est donc structurellement nul ; il est **prouvé** par test (voir AC-2). Aucun upload d'asset utilisateur en v1 (catalogue 100 % statique) → aucun vecteur d'injection de contenu.

### D6 — Hors périmètre v1 (scopé explicitement)
Couleurs custom (accent au choix) · storefront publique / app client (spec = les 5 refs mobile : Baya, Taco Bell, QuickB×2, UI Kit → **phase 2**) · images uploadées par tenant · ton par page · i18n des noms de tons.

## 3. Décomposition (estimation, ordre d'exécution)

| # | Travail | Note |
|---|---|---|
| W1 | **Audit + migration des composants en tokens** (remplacer les couleurs hardcodées) | Le gros du chantier — le seul point de risque |
| W2 | `themes.ts` (12×2) + resolver + tests unitaires | |
| W3 | Migration 0004 (drizzle) + preuve sur PG (schéma idempotent) | |
| W4 | `PATCH /api/org/theme` + garde ADMIN + 403 | |
| W5 | UI sélecteur (cartes 12 tons + toggle sombre/clair, page Réglages) | |
| W6 | Tests e2e isolation (harness 55433-55436) | |

## 4. Critères d'acceptation

- **AC-1** : tenant A met `ember-noir` → les variables CSS de sa page correspondent au set ember-noir (mode choisi) ; le toggle mode applique la variante claire du même ton.
- **AC-2** (isolation) : dans le harness, tenant B (pool distinct, même base) ne voit **aucun** effet du choix de A ; `theme_id` illisible hors de son org (RLS existante).
- **AC-3** (fail-closed) : `theme_id` forcé à une valeur inconnue en base directe → rendu neutre, app fonctionnelle, zéro 500.
- **AC-4** : `PATCH` par un rôle non ADMIN → 403 ; par un tenant étranger → 403/404 ; append-only ADR-0014 **intact** (la colonne ne touche ni `manual_approvals` ni tokens).
- **AC-5** : build vert + **117/117 tests existants verts** + nouveaux tests (resolver, endpoint, isolation).

## 5. Risques & réponses

- **UI actuelle hardcodée** (W1) : audit systématique des composants avant de brancher les tokens ; si un composant résiste, il est mis en tokens avant tout autre ton.
- **Scope creep des 32 maquettes** : le catalogue est gelé à 12 ; toute demande supplémentaire = amendement ADR.
- **Contraste/accessibilité** : chaque set porte `accentContrast` ; check manuel de lisibilité des 24 skins au passage W5 (pas de tooling auto en v1).

## 6. Rollout

`main` (post-stack) → `feat/tenant-theming` → PR → **CI 7/7** → validation CTO → merge. Aucun changement de contrat public ; aucun secret ; aucun nouveau module backend.
