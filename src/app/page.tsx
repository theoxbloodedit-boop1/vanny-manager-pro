"use client";

import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  Check,
  Clock,
  KeyRound,
  Pill,
  ShieldCheck,
  Scissors,
  Store,
  Users,
  UtensilsCrossed,
  Wine,
} from "lucide-react";
import { Logo, LogoMark } from "@/components/ui";
import { Reveal, StaggerGroup, CARD_HOVER } from "@/components/motion";
import { motion } from "framer-motion";

export const dynamic = "force-static";

/**
 * Page d'accueil — vitrine SaaS.
 *
 * Règle du produit : on n'affiche jamais une fonctionnalité qui n'existe pas.
 * La page doit faire comprendre le SaaS en 10 secondes :
 *   1. CE QUE C'EST   — un espace pour gérer une activité de commerce
 *   2. POUR QUI       — pharmacie, bar, restaurant, salon, boutique
 *   3. POURQUOI       — contrôle total, équipes, devises, multi-succursales
 */

const SECTORS = [
  {
    id: "boutique",
    label: "Boutique",
    icon: Store,
    promise:
      "Catalogue de produits, stock, prix en USD et CDF — sans jamais les confondre.",
  },
  {
    id: "bar",
    label: "Bar",
    icon: Wine,
    promise:
      "Inventaire des consommations, équipes de soirée et succursales qui restent ordonnées.",
  },
  {
    id: "restaurant",
    label: "Restaurant",
    icon: UtensilsCrossed,
    promise:
      "Produits, stock et équipes de salle : tout ce qui se passe en cuisine et en caisse, suivi.",
  },
  {
    id: "salon",
    label: "Salon / beauté",
    icon: Scissors,
    promise:
      "Prestations, stock de produits et collaborateurs : une activité de service qui reste contrôlée.",
  },
  {
    id: "pharmacy",
    label: "Pharmacie",
    icon: Pill,
    promise:
      "Références, stock rigoureux et facturation : une activité sensible, gérée avec précision.",
  },
] as const;

const WHY = [
  {
    icon: ShieldCheck,
    title: "Un contrôle total, en un tableau de bord",
    text: "Organisation, catalogue, stock, équipes, succursales, branding : tout est visible et piloté depuis un même espace admin.",
  },
  {
    icon: Users,
    title: "Équipes et rôles qui tiennent",
    text: "Propriétaire, manager, caissier, comptable… chacun agit exactement là où il en a le droit, partout ailleurs il est bloqué.",
  },
  {
    icon: Banknote,
    title: "USD et CDF, côte à côte",
    text: "Deux devises gérées séparément, jamais converties silencieusement. Les prix restent ce que vous avez saisi.",
  },
  {
    icon: Store,
    title: "Multi-succursales, isolé",
    text: "Une activité peut avoir plusieurs succursales. Un membre ne travaille que dans celles qui lui sont assignées.",
  },
  {
    icon: KeyRound,
    title: "Invitations qui fonctionnent",
    text: "Vos collaborateurs rejoignent par invitation. Une invitation valide est une confiance — pas besoin d'email confirmé.",
  },
  {
    icon: Check,
    title: "Une promesse tenue : on n'invente rien",
    text: "Chaque fonctionnalité affichée ici est réelle, déployée et testée. Tout ce qui n'est pas prêt est dit explicitement.",
  },
] as const;

const STEPS = [
  {
    title: "Créez votre compte",
    text: "Deux minutes : votre compte, votre activité, votre première succursale.",
  },
  {
    title: "Invitez votre équipe",
    text: "Invitations, rôles et succursales attribués — chacun rejoint dans son périmètre.",
  },
  {
    title: "Pilotez au quotidien",
    text: "Catalogue, stock, équipes, succursales : un contrôle total, revu à chaque connexion.",
  },
];

const LIVE = [
  "Organisation, succursales et membres — multi-tenant isolé en base (RLS)",
  "Catalogue produits, catégories et stock, avec coûts et franchise",
  "Invitations, rôles et permissions — l'invitation valide est une confiance",
  "Tableau de bord admin complet : catalogue, stock, équipes, succursales, marque",
  "Branding personnalisable : nom, logo et couleur de votre activité",
  "Tarifs normalisés USD / CDF, jamais convertis silencieusement",
];

const COMING = [
  "Point de vente et caisses (USD et CDF séparés)",
  "Transferts de stock inter-succursales",
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
        {/* Hero — la réponse en 10 secondes */}
        <section className="relative overflow-hidden grid items-center gap-10 py-14 md:grid-cols-2 md:gap-12 md:py-20">
          <div className="aurora" aria-hidden />
          <div className="relative-z grid w-full items-center gap-10 md:grid-cols-2 md:gap-12">
          <Reveal>
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface px-3 py-1 text-xs font-semibold text-muted-foreground">
              <ShieldCheck className="size-3.5 text-primary" aria-hidden />
              Le SaaS de gestion pour vos commerces — conçu pour la RDC
            </span>
            <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">
              Gérez votre commerce,
              <br />
              <span className="text-primary">tout en un seul espace.</span>
            </h1>
            <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
              VANNY est une plateforme SaaS pour les petites et moyennes activités de
              commerce. Une seule connexion, un contrôle total sur votre catalogue,
              votre stock, vos équipes et vos succursales.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/auth"
                className="inline-flex min-h-12 items-center gap-2 rounded-control bg-primary px-6 text-sm font-bold text-white shadow-pop transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary-hover hover:shadow-float"
              >
                Commencer maintenant
                <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
              </Link>
              <Link
                href="/auth"
                className="inline-flex min-h-12 items-center rounded-control border border-border-strong bg-surface-raised px-6 text-sm font-bold text-foreground transition-all duration-300 hover:-translate-y-0.5 hover:bg-surface"
              >
                Se connecter
              </Link>
            </div>
            <p className="mt-7 text-xs font-medium text-muted-foreground">
              Pharmacie · Bar · Restaurant · Salon · Boutique — chaque activité
              est structurée et optimisée selon son métier.
            </p>
          </Reveal>
          <Reveal variant="fade" delay={0.15}>
            <Mockup />
          </Reveal>
          </div>
        </section>

        {/* Pourquoi nous choisir */}
        <section className="pb-14 md:pb-20">
          <div className="mb-8 max-w-xl">
            <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
              Pourquoi nous choisir
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Le SaaS ne doit pas être une boîte noire. VANNY est pensé pour le
              contrôle, la clarté et la confiance — pas seulement pour faire
              fonctionner des tables.
            </p>
          </div>
          <StaggerGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {WHY.map((v) => (
              <motion.div
                key={v.title}
                variants={CARD_HOVER}
                whileHover="hover"
                className="rounded-card border border-border bg-surface-raised p-5 shadow-card"
              >
                <span className="flex size-11 items-center justify-center rounded-control bg-primary-soft text-primary">
                  <v.icon className="size-5.5" aria-hidden />
                </span>
                <h3 className="mt-4 font-bold tracking-tight">{v.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{v.text}</p>
              </motion.div>
            ))}
          </StaggerGroup>
        </section>

        {/* Optimisé par activité */}
        <section className="border-y border-border bg-surface py-14 md:py-16">
          <div className="mb-8 max-w-xl">
            <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
              Une plateforme optimisée selon votre activité
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Chaque métier a ses besoins. VANNY structure votre activité dès le
              départ, avec les modules adaptés à ce que vous faites chaque jour.
            </p>
          </div>
          <StaggerGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SECTORS.map((s) => (
              <motion.div
                key={s.id}
                variants={CARD_HOVER}
                whileHover="hover"
                className="rounded-card border border-border bg-surface-raised p-5 shadow-card"
              >
                <span className="flex size-11 items-center justify-center rounded-control bg-primary-soft text-primary">
                  <s.icon className="size-5.5" aria-hidden />
                </span>
                <h3 className="mt-4 font-bold tracking-tight">{s.label}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  {s.promise}
                </p>
              </motion.div>
            ))}
          </StaggerGroup>
        </section>

        {/* Comment ça marche */}
        <section className="py-14 md:py-16">
          <div className="mb-8 max-w-xl">
            <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
              Opérationnel en trois étapes
            </h2>
          </div>
          <StaggerGroup className="grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <motion.li
                key={s.title}
                variants={CARD_HOVER}
                whileHover="hover"
                className="rounded-card border border-border bg-surface-raised p-5 shadow-card"
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-bold tracking-tight">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{s.text}</p>
              </motion.li>
            ))}
          </StaggerGroup>
        </section>

        {/* Statut honnête */}
        <section className="border-t border-border bg-surface py-14 md:py-16">
          <div className="grid gap-4 md:grid-cols-2">
            <Reveal className="rounded-card border border-border bg-surface-raised p-5 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-float">
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-control bg-success-soft text-success">
                  <KeyRound className="size-4.5" aria-hidden />
                </span>
                <h2 className="font-bold tracking-tight">Déjà opérationnel</h2>
              </div>
              <ul className="space-y-2.5">
                {LIVE.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2.5 text-sm leading-6 text-foreground"
                  >
                    <Check className="mt-1 size-4 shrink-0 text-success" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={0.1} className="rounded-card border border-border bg-surface p-5 transition-all duration-300 hover:-translate-y-1">
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
                  <li
                    key={item}
                    className="flex items-start gap-2.5 text-sm leading-6 text-muted-foreground"
                  >
                    <Clock className="mt-1 size-4 shrink-0" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* CTA final */}
        <section className="pb-16 md:pb-20">
          <Reveal className="overflow-hidden rounded-card border border-border bg-gradient-to-br from-primary-faint via-background to-primary-soft/70 p-8 text-center shadow-card sm:p-12">
            <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
              Prêt à gérer votre activité proprement ?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              Créez votre organisation maintenant. Vos équipes rejoignent par
              invitation, chacune dans son périmètre. Et à chaque reconnexion,
              vous retombez sur votre tableau de bord — pas sur une création.
            </p>
            <Link
              href="/auth"
              className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-control bg-primary px-7 text-sm font-bold text-white shadow-pop transition-colors hover:bg-primary-hover"
            >
              Créer mon compte
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Reveal>
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
