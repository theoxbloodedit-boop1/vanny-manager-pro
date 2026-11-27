"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Pill, Scissors, Store, UtensilsCrossed, Wine } from "lucide-react";
import {
  ApiErrorText,
  Button,
  Card,
  Field,
  Input,
  Logo,
  Segmented,
  Select,
  Spinner,
} from "@/components/ui";

/**
 * Onboarding — la première organisation de l'utilisateur (Module A).
 *
 * Le slug est proposé à partir du nom (modifiable). Le secteur choisit ici
 * pilote les modules activés plus tard (phases 2+) : boutique, bar,
 * restaurant, salon, pharmacie.
 */

const SECTORS = [
  ["boutique", "Boutique / commerce", Store],
  ["bar", "Bar", Wine],
  ["restaurant", "Restaurant", UtensilsCrossed],
  ["salon", "Salon / beauté", Scissors],
  ["pharmacy", "Pharmacie", Pill],
] as const;

type SectorValue = (typeof SECTORS)[number][0];

const TIMEZONES = [
  "Africa/Kinshasa",
  "Africa/Lubumbashi",
  "Africa/Kisangani",
  "Africa/Bujumbura",
  "Africa/Dar_es_Salaam",
  "Africa/Nairobi",
  "Africa/Kampala",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Europe/Paris",
] as const;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

interface Me {
  authenticated: boolean;
  organization?: { name: string } | null;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  // null = slug auto-généré depuis le nom ; sinon valeur saisie par l'user.
  const [slugDraft, setSlugDraft] = useState<string | null>(null);
  const slug = slugDraft ?? slugify(name);
  const [sector, setSector] = useState<SectorValue>("boutique");
  const [baseCurrency, setBaseCurrency] = useState<"USD" | "CDF">("USD");
  const [timezone, setTimezone] = useState<string>("Africa/Kinshasa");
  const [firstBranchName, setFirstBranchName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async (): Promise<Me> =>
      (await fetch("/api/me", { cache: "no-store" })).json(),
  });

  useEffect(() => {
    if (me && !me.authenticated) router.replace("/auth");
    if (me?.organization) router.replace("/admin");
  }, [me, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug,
          sector,
          baseCurrency,
          timezone,
          firstBranchName,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(data.message || "Création impossible");
      router.replace("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue");
      setBusy(false);
    }
  }

  if (isLoading || !me) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner />
      </main>
    );
  }

  if (!me.authenticated || me.organization) return null; // redirecting

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg p-6">
      <header className="mb-6 flex items-center gap-3">
        <Logo compact />
      </header>

      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight">
          Créez votre organisation
        </h1>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          Ces informations définissent votre espace de travail. Vous pourrez
          ajouter des succursales et des équipes ensuite.
        </p>
      </div>

      <Card title="Votre entreprise" subtitle="Visible par vos équipes, modifiable plus tard.">
        <form onSubmit={submit} className="space-y-5">
          <Field label="Nom de l’entreprise">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. Lunetterie Alpha"
              required
              minLength={2}
              maxLength={120}
            />
          </Field>

          <Field
            label="Identifiant (slug)"
            hint="Utilisé dans les liens. Lettres minuscules, chiffres et tirets."
          >
            <Input
              value={slug}
              onChange={(e) =>
                setSlugDraft(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, "")
                    .slice(0, 48),
                )
              }
              pattern="[a-z0-9]+(-[a-z0-9-])*"
              required
              minLength={2}
            />
          </Field>

          <div className="space-y-1.5">
            <span className="text-sm font-semibold text-foreground">
              Secteur d’activité
            </span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SECTORS.map(([value, label, Icon]) => {
                const active = sector === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSector(value)}
                    aria-pressed={active}
                    className={`relative flex min-h-16 flex-col items-start gap-1.5 rounded-control border p-3 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary-faint ring-2 ring-primary-soft"
                        : "border-border bg-surface-raised hover:border-border-strong hover:bg-surface"
                    }`}
                  >
                    <span
                      className={`flex size-8 items-center justify-center rounded-control ${
                        active ? "bg-primary text-white" : "bg-surface-inset text-muted-foreground"
                      }`}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className={`text-xs font-semibold leading-4 ${active ? "text-primary" : "text-foreground"}`}>
                      {label}
                    </span>
                    {active ? (
                      <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-white">
                        <Check className="size-3" aria-hidden />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-semibold text-foreground">Devise de base</span>
            <Segmented
              className="grid-cols-2"
              value={baseCurrency}
              onChange={setBaseCurrency}
              options={[
                { value: "USD", label: "USD — Dollar" },
                { value: "CDF", label: "CDF — Franc congolais" },
              ]}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Les prix restent indépendants USD et CDF ; c’est la devise par
              défaut de votre comptabilité.
            </p>
          </div>

          <Field label="Fuseau horaire">
            <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Première succursale"
            hint="Le point de vente principal où vous commencez."
          >
            <Input
              value={firstBranchName}
              onChange={(e) => setFirstBranchName(e.target.value)}
              placeholder="Ex. Centre-ville"
              required
              maxLength={120}
            />
          </Field>

          <ApiErrorText error={error} />

          <Button type="submit" loading={busy} className="w-full">
            Créer mon organisation
          </Button>
        </form>
      </Card>
    </main>
  );
}
