"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { signInEmail, signUpEmail } from "@/lib/auth-client";
import { ApiErrorText, Button, Field, Input, Logo, Segmented } from "@/components/ui";

/**
 * Connexion / Inscription (Module A).
 *
 * After a successful call we go to /post-auth, which orchestrates:
 * email verification → invitation acceptance → onboarding → admin.
 */
export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (mode === "signup") {
        const r = await signUpEmail({ name, email, password });
        if (!r.ok) throw new Error(r.error || "Inscription impossible");
      } else {
        const r = await signInEmail({ email, password });
        if (!r.ok) throw new Error(r.error || "Connexion impossible");
      }
      router.replace("/post-auth");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex justify-center">
        <Logo />
      </div>

      <div className="rounded-card border border-border bg-surface-raised p-5 shadow-card sm:p-6">
        <div className="mb-5">
          <Segmented
            className="grid-cols-2"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(undefined);
            }}
            options={[
              { value: "signin", label: "Connexion" },
              { value: "signup", label: "Inscription" },
            ]}
          />
          <h1 className="mt-5 text-lg font-bold tracking-tight">
            {mode === "signin" ? "Content de vous revoir" : "Créez votre compte"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Accédez à votre organisation."
              : "Deux minutes, puis vous invitez votre équipe."}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <Field label="Nom complet">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex. Alice Mutombo"
                autoComplete="name"
                required
              />
            </Field>
          )}
          <Field label="Adresse email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@exemple.cd"
              autoComplete="email"
              required
            />
          </Field>
          <Field
            label="Mot de passe"
            hint={
              mode === "signup"
                ? "8 caractères minimum, lettres et chiffres."
                : undefined
            }
          >
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              minLength={8}
              required
            />
          </Field>

          <ApiErrorText error={error} />

          <Button type="submit" loading={busy} className="w-full">
            {mode === "signin" ? "Se connecter" : "Créer mon compte"}
          </Button>
        </form>
      </div>

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 text-success" aria-hidden />
        Vos données restent dans votre organisation, isolées des autres clients.
      </p>
    </main>
  );
}
