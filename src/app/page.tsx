import Link from "next/link";

export const dynamic = "force-static";

/**
 * Page d'accueil (Module A).
 *
 * N'est PAS un tableau de bord : il n'y a pas de données métier à afficher
 * ici (phases 2+). Elle indique l'état réel du produit et mène à la création
 * de compte. Aucune fonctionnalité inexistante n'est promise.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6 md:p-10">
      <header className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-card bg-primary text-white">
          <span className="text-xl font-bold">V</span>
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            VANNY MANAGER PRO
          </h1>
          <p className="text-sm text-muted-foreground">
            Gestion multi-activités, d’abord pour la RDC
          </p>
        </div>
      </header>

      <section className="rounded-card border border-border bg-surface-raised p-6 shadow-sm">
        <div className="flex flex-col items-start gap-4">
          <div>
            <h2 className="font-semibold">
              Votre boutique, votre bar, votre restaurant — gérés proprement.
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              VANNY MANAGER PRO est une application de gestion pour
              entrepreneurs africains : ventes, stock, caisses et équipes dans
              un seul espace, en USD et en CDF, sans les confondre.
            </p>
          </div>
          <Link
            href="/auth"
            className="inline-flex min-h-11 items-center justify-center rounded-control bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            Créer un compte
          </Link>
          <p className="text-xs text-muted-foreground">
            Déjà un compte ?{" "}
            <Link href="/auth" className="font-medium text-primary hover:underline">
              Se connecter
            </Link>
          </p>
        </div>
      </section>

      <section className="rounded-card border border-border bg-surface p-6">
        <h2 className="mb-3 text-sm font-semibold">
          Ce qui est déjà opérationnel
        </h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>Comptes, organisations et succursales, multi-tenant isolé</li>
          <li>Invitations par email avec vérification, rôles et permissions</li>
          <li>
            Accès par succursale : chacun ne travaille là où il a le droit
          </li>
          <li>
            Tarifs normalisés USD / CDF, jamais convertis silencieusement
          </li>
        </ul>
        <h2 className="mb-2 mt-5 text-sm font-semibold">
          En préparation (pas encore annoncé ni utilisable)
        </h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>Point de vente et caisses (USD et CDF séparés)</li>
          <li>Stock, transferts inter-succursales, clients et fournisseurs</li>
          <li>Mode hors-ligne testé sur appareil Android</li>
        </ul>
      </section>

      <footer className="text-xs text-muted-foreground">
        Nous n’affichons jamais une fonctionnalité qui n’existe pas.
      </footer>
    </main>
  );
}
