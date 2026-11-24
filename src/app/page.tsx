import { CircleAlert } from "lucide-react";

export const dynamic = "force-static";

/**
 * Phase 0 status page.
 *
 * Deliberately NOT a dashboard. There is no business data to show yet, and a
 * screen full of invented numbers would violate the "no fake analytics" rule.
 * This page states exactly where the project stands and is replaced in Phase 3.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6 md:p-10">
      <header className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-card bg-primary text-white">
          <span className="text-xl font-bold">V</span>
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">VANNY MANAGER PRO</h1>
          <p className="text-sm text-muted-foreground">
            Phase 0 — fondations
          </p>
        </div>
      </header>

      <section className="rounded-card border border-border bg-surface-raised p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 size-5 text-primary" aria-hidden />
          <div className="space-y-2">
            <h2 className="font-semibold">Aucun module métier n’est disponible.</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Ce dépôt en est à la phase 0 : outillage, schéma de données et
              pipeline d’intégration continue. Les ventes, le stock, les clients et
              les dépenses arrivent aux phases 2 à 4.
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              Aucune donnée n’est affichée ici parce qu’il n’y en a pas encore —
              volontairement.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-card border border-border bg-surface p-6">
        <h2 className="mb-3 text-sm font-semibold">Ce qui existe déjà</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>Schéma multi-tenant : organisations, succursales, catalogue</li>
          <li>Tarifs normalisés USD / CDF, jamais convertis silencieusement</li>
          <li>Caisses physiques distinctes des caissiers et des devises</li>
          <li>Identifiants UUIDv7 générés côté client (prêt pour le hors-ligne)</li>
          <li>CI : typecheck, lint, tests, build, garde-fou PWA</li>
        </ul>
      </section>

      <footer className="text-xs text-muted-foreground">
        Ne jamais afficher une fonctionnalité qui n’existe pas.
      </footer>
    </main>
  );
}
