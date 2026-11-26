"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiErrorText, Button, Card, Field, Input, Select, Spinner } from "@/components/ui";

/**
 * Onboarding — la première organisation de l'utilisateur (Module A).
 *
 * Le slug est proposé à partir du nom (modifiable). Le secteur choisit ici
 * pilote les modules activés plus tard (phases 2+) : boutique, bar,
 * restaurant, salon, pharmacie.
 */

const SECTORS = [
  ["boutique", "Boutique / commerce"],
  ["bar", "Bar"],
  ["restaurant", "Restaurant"],
  ["salon", "Salon de coiffure / beauté"],
  ["pharmacy", "Pharmacie"],
] as const;

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
  const [sector, setSector] = useState<(typeof SECTORS)[number][0]>("boutique");
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
      const data = (await res.json()) as { message?: string };
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
    <main className="mx-auto min-h-screen max-w-lg p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Créez votre organisation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ces informations définissent votre espace de travail. Vous pourrez
          ajouter des succursales et des équipes ensuite.
        </p>
      </header>

      <Card title="Votre entreprise">
        <form onSubmit={submit} className="space-y-4">
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
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              required
              minLength={2}
            />
          </Field>

          <Field label="Secteur d’activité">
            <Select
              value={sector}
              onChange={(e) =>
                setSector(e.target.value as (typeof SECTORS)[number][0])
              }
            >
              {SECTORS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Devise de base"
            hint="Les prix restent indépendants USD et CDF ; c’est la devise par défaut de votre comptabilité."
          >
            <Select
              value={baseCurrency}
              onChange={(e) =>
                setBaseCurrency(e.target.value as "USD" | "CDF")
              }
            >
              <option value="USD">USD — Dollar américain</option>
              <option value="CDF">CDF — Franc congolais</option>
            </Select>
          </Field>

          <Field label="Fuseau horaire">
            <Select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
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
