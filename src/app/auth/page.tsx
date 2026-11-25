"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signInEmail, signUpEmail } from "@/lib/auth-client";
import { ApiErrorText, Button, Field, Input } from "@/components/ui";

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <header className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-card bg-primary text-white">
          <span className="text-xl font-bold">V</span>
        </span>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            VANNY MANAGER PRO
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "signin" ? "Content de vous revoir" : "Créez votre compte"}
          </p>
        </div>
      </header>

      <div className="rounded-card border border-border bg-surface-raised p-5 shadow-sm">
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-control bg-surface p-1">
          {(
            [
              ["signin", "Connexion"],
              ["signup", "Inscription"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(undefined);
              }}
              className={`min-h-10 rounded-[0.5rem] text-sm font-semibold transition-colors ${
                mode === m
                  ? "bg-surface-raised text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
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

      <p className="text-center text-xs text-muted-foreground">
        Vos données restent dans votre organisation, isolées des autres
        clients.
      </p>
    </main>
  );
}
