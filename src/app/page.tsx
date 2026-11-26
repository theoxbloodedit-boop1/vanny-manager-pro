import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  Check,
  Clock,
  KeyRound,
  ShieldCheck,
  Store,
  Users,
} from "lucide-react";
import { Logo, LogoMark } from "@/components/ui";

export const dynamic = "force-static";

/**
 * Page d'accueil — vitrine produit.
 *
 * Règle du produit (inchangée) : on n'affiche jamais une fonctionnalité
 * qui n’existe pas. La section « En préparation » le rappelle explicitement.
 * Le mockup ci-dessous reproduit l'écran d'administration réel.
 */

const VALUE_PROPS = [
  {
    icon: ShieldCheck,
    title: "Isolé, de bout en bout",
    text: "Chaque organisation vit dans son propre espace, isolé en base (RLS). Vos données ne se mélangent jamais à celles d'un autre client.",
  },
  {
    icon: Banknote,
    title: "USD et CDF, sans confusion",
    text: "Deux devises gérées côte à côte, jamais converties silencieusement. Les prix restent ce que vous avez saisi.",
  },
  {
    icon: Users,
    title: "Équipes et rôles clairs",
    text: "Propriétaire, manager, caissier, comptable… chaque membre agit exactement là où il en a le droit, partout ailleurs bloqué.",
  },
  {
    icon: Store,
    title: "Multi-succursales",
    text: "Un membre ne travaille que dans les succursales qui lui sont assignées. Vous voyez tout, chacun ne voit que son périmètre.",
  },
];

const STEPS = [
  {
    title: "Créez votre compte",
    text: "Deux minutes : votre compte, votre organisation, votre première succursale.",
  },
  {
    title: "Vérifiez, invitez, assignez",
    text: "Email vérifié, invitations envoyées, rôles et succursales attribués — sans reconnexion.",
  },
  {
    title: "Gérez, suivez, grandissez",
    text: "Ajoutez des succursales et des équipes au fil de la croissance. Tout reste isolé et traçable.",
  },
];

const LIVE = [
  "Comptes, organisations et succursales, multi-tenant isolé",
  "Invitations par email avec vérification, rôles et permissions",
  "Accès par succursale : chacun ne travaille que là où il a le droit",
  "Tarifs normalisés USD / CDF, jamais convertis silencieusement",
];

const COMING = [
  "Point de vente et caisses (USD et CDF séparés)",
  "Stock, transferts inter-succursales, clients et fournisseurs",
  "Mode hors-ligne testé sur appareil Android",
];

function Mockup() {
  const members = [
    { name: "Alice Mutombo", role: "Propriétaire", tone: "bg-primary-soft text-primary" },
    { name: "Jean Kambala", role: "Manager", tone: "bg-surface-inset text-muted-foreground" },
    { name: "Sara Ilunga", role: "Caissier", tone: "bg-surface-inset text-muted-foreground" },
  ];
  return (
    <div className="relative" aria-hidden>
      {/* halo décoratif */}
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-primary-faint via-transparent to-primary-soft/60" />
      <div className="overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-float">
        {/* barre de fenêtre */}
        <div className="flex items-center gap-1.5 border-b border-border bg-surface px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-accent/70" />
          <span className="size-2.5 rounded-full bg-warning/70" />
          <span className="size-2.5 rounded-full bg-success/70" />
          <span className="ml-3 text-xs font-medium text-muted-foreground">
            app.vannymanager.cd/admin
          </span>
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          {/* entête org */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <LogoMark className="size-8" />
              <div>
                <p className="text-sm font-bold leading-4">Lunetterie Alpha</p>
                <div className="mt-1 flex gap-1.5">
                  <span className="rounded-pill bg-primary-soft px-2 py-px text-[0.65rem] font-semibold text-primary">
                    Boutique
                  </span>
                  <span className="rounded-pill bg-surface-inset px-2 py-px text-[0.65rem] font-semibold text-muted-foreground">
                    USD
                  </span>
                </div>
              </div>
            </div>
            <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-[0.65rem] font-bold text-primary">
              AM
            </span>
          </div>
          {/* stats */}
          <div className="grid grid-cols-3 gap-2.5">
            {[
              ["4", "Membres"],
              ["2", "Succursales"],
              ["1", "Invitation"],
            ].map(([v, l]) => (
              <div
                key={l}
                className="rounded-xl border border-border bg-surface p-3"
              >
                <p className="text-lg font-extrabold leading-5 tabular-nums">{v}</p>
                <p className="text-[0.7rem] font-medium text-muted-foreground">{l}</p>
              </div>
            ))}
          </div>
          {/* membres */}
          <div className="rounded-xl border border-border bg-surface p-3">
            <p className="mb-2 text-[0.7rem] font-bold tracking-wide text-muted-foreground">
              ÉQUIPE
            </p>
            <ul className="divide-y divide-border">
              {members.map((m) => (
                <li key={m.name} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <span className="flex size-6.5 items-center justify-center rounded-full bg-primary-soft text-[0.6rem] font-bold text-primary">
                      {m.name.split(" ").map((p) => p[0]).join("")}
                    </span>
                    <span className="text-xs font-medium">{m.name}</span>
                  </div>
                  <span className={`rounded-pill px-2 py-px text-[0.65rem] font-semibold ${m.tone}`}>
                    {m.role}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="flex items-center gap-2">
            <Link
              href="/auth"
              className="inline-flex min-h-10 items-center rounded-control px-3 text-sm font-semibold text-foreground hover:bg-surface"
            >
              Se connecter
            </Link>
            <Link
              href="/auth"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-control bg-primary px-4 text-sm font-semibold text-white shadow-card transition-colors hover:bg-primary-hover"
            >
              Créer un compte
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Hero */}
        <section className="grid items-center gap-10 py-14 md:grid-cols-2 md:gap-12 md:py-20">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface px-3 py-1 text-xs font-semibold text-muted-foreground">
              <ShieldCheck className="size-3.5 text-primary" aria-hidden />
              Multi-tenant isolé · Conçu pour la RDC
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">
              Votre activité,
              <br />
              <span className="text-primary">gérée proprement.</span>
            </h1>
            <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
              Ventes, stock, caisses et équipes dans un seul espace.
              Multi-succursales, rôles clairs, USD et CDF côte à côte — sans
              jamais les confondre.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/auth"
                className="inline-flex min-h-12 items-center gap-2 rounded-control bg-primary px-6 text-sm font-bold text-white shadow-pop transition-colors hover:bg-primary-hover"
              >
                Commencer maintenant
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link
                href="/auth"
                className="inline-flex min-h-12 items-center rounded-control border border-border-strong bg-surface-raised px-6 text-sm font-bold text-foreground hover:bg-surface"
              >
                Se connecter
              </Link>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground">
              {["Boutiques", "Bars", "Restaurants", "Salons", "Pharmacies"].map((s) => (
                <li key={s} className="flex items-center gap-1.5">
                  <Check className="size-3.5 text-success" aria-hidden />
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <Mockup />
        </section>

        {/* Valeurs */}
        <section className="pb-14 md:pb-20">
          <div className="mb-8 max-w-xl">
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              Construit pour la confiance
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              De l’argent et du stock de plusieurs activités passent par VANNY.
              Chaque choix est fait pour que rien ne fuite, rien ne se mélange.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {VALUE_PROPS.map((v) => (
              <div
                key={v.title}
                className="rounded-card border border-border bg-surface-raised p-5 shadow-card"
              >
                <span className="flex size-11 items-center justify-center rounded-control bg-primary-soft text-primary">
                  <v.icon className="size-5.5" aria-hidden />
                </span>
                <h3 className="mt-4 font-bold tracking-tight">{v.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{v.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Comment ça marche */}
        <section className="border-y border-border bg-surface py-14 md:py-16">
          <div className="mb-8 max-w-xl">
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              Opérationnel en trois étapes
            </h2>
          </div>
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className="rounded-card border border-border bg-surface-raised p-5 shadow-card"
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-bold tracking-tight">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Statut honnête */}
        <section className="py-14 md:py-16">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-card border border-border bg-surface-raised p-5 shadow-card">
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-control bg-success-soft text-success">
                  <KeyRound className="size-4.5" aria-hidden />
                </span>
                <h2 className="font-bold tracking-tight">Déjà opérationnel</h2>
              </div>
              <ul className="space-y-2.5">
                {LIVE.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm leading-6 text-foreground">
                    <Check className="mt-1 size-4 shrink-0 text-success" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-card border border-border bg-surface p-5">
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-control bg-surface-inset text-muted-foreground">
                  <Clock className="size-4.5" aria-hidden />
                </span>
                <h2 className="font-bold tracking-tight">En préparation</h2>
                <span className="rounded-pill bg-surface-inset px-2.5 py-0.5 text-[0.65rem] font-bold text-muted-foreground">
                  pas encore utilisable
                </span>
              </div>
              <ul className="space-y-2.5">
                {COMING.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm leading-6 text-muted-foreground">
                    <Clock className="mt-1 size-4 shrink-0" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* CTA final */}
        <section className="pb-16 md:pb-20">
          <div className="overflow-hidden rounded-card border border-border bg-gradient-to-br from-primary-faint via-background to-primary-soft/70 p-8 text-center shadow-card sm:p-12">
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              Prêt à gérer proprement ?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              Créez votre organisation maintenant. Vos équipes rejoignent par
              invitation, chacune dans son périmètre.
            </p>
            <Link
              href="/auth"
              className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-control bg-primary px-7 text-sm font-bold text-white shadow-pop transition-colors hover:bg-primary-hover"
            >
              Créer mon compte
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 sm:flex-row sm:px-6">
          <Logo compact />
          <p className="text-xs text-muted-foreground">
            Nous n’affichons jamais une fonctionnalité qui n’existe pas.
          </p>
        </div>
      </footer>
    </div>
  );
}
