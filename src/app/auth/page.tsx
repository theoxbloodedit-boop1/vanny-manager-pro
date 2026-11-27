"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Mail, MessageCircle, ShieldCheck } from "lucide-react";
import {
  signInEmail,
  signInPhone,
  signUpEmail,
  signUpPhone,
} from "@/lib/auth-client";
import { ApiErrorText, Button, Field, Input, Logo, Segmented } from "@/components/ui";
import { Reveal } from "@/components/motion";

/**
 * Connexion / Inscription (Module A + ADR-0016).
 *
 * Two identifiers: email or WhatsApp number.
 *   - Sign-in : one field (« Email ou WhatsApp ») — no @ → phone path.
 *   - Sign-up : Email / WhatsApp choice. A WhatsApp account (no mailbox) is
 *     validated by the team, then the customer creates their organization.
 *
 * After a successful call we go to /post-auth, which orchestrates:
 * verification / approval → invitation acceptance → onboarding → admin.
 *
 * ADR-0017: an invitation link (`/auth?email=…`, shared over WhatsApp)
 * pre-fills the invitee's email and starts on the sign-up mode — the email
 * IS the invitation identity (no token, nothing extra leaked).
 */
export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signupVia, setSignupVia] = useState<"email" | "phone">("email");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [inviteEmail, setInviteEmail] = useState<string>();

  // ADR-0017: honor a shared invitation link (client-side only, no API).
  // Reading window.location on mount and seeding state from it is the
  // canonical "sync from an external system" effect — the rule it trips is
  // about effects that re-run / cascade, not one-shot mount hydration.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const email = params.get("email");
    const phone = params.get("phone");
    if (phone) {
      // ADR-0032: WhatsApp invitation — pre-fill the phone sign-up.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount hydration from the URL (see comment above)
      setPhone(phone);
      setMode("signup");
      setSignupVia("phone");
    } else if (email && email.includes("@")) {
      setInviteEmail(email);
      setMode("signup");
      setSignupVia("email");
      setIdentifier(email);
    }
  }, []);

  const phoneMode = mode === "signup" && signupVia === "phone";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      let ok: { ok: boolean; error?: string };
      if (mode === "signup") {
        ok = phoneMode
          ? await signUpPhone({ name, phone, password })
          : await signUpEmail({ name, email: identifier, password });
        if (!ok.ok) throw new Error(ok.error || "Inscription impossible");
      } else {
        // One field, two paths: an address with @ is an email, otherwise a
        // WhatsApp number (the server normalizes it).
        ok = identifier.includes("@")
          ? await signInEmail({ email: identifier, password })
          : await signInPhone({ phone: identifier, password });
        if (!ok.ok) throw new Error(ok.error || "Connexion impossible");
      }
      router.replace("/post-auth");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <Reveal>
        <div className="flex justify-center">
          <Logo />
        </div>
      </Reveal>

      <Reveal delay={0.08}>
      <div className="rounded-card border border-border bg-surface-raised p-5 shadow-card sm:p-6">
        {inviteEmail && (
          <div className="mb-4 flex items-start gap-2 rounded-control border border-primary-soft bg-primary-soft/40 p-3 text-sm">
            <Mail className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <p className="leading-5 text-muted-foreground">
              <span className="font-semibold text-foreground">
                Vous avez été invité·e.
              </span>{" "}
              Créez votre compte (ou connectez-vous) avec l’adresse
              pré-remplie ci-dessous :{" "}
              <span className="break-all font-semibold text-foreground">
                {inviteEmail}
              </span>
              , puis acceptez l’invitation.
            </p>
          </div>
        )}
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
          {mode === "signup" && (
            <Segmented
              className="mt-4 grid-cols-2"
              value={signupVia}
              onChange={(v) => {
                setSignupVia(v);
                setError(undefined);
              }}
              options={[
                { value: "email", label: "Avec email" },
                { value: "phone", label: "Avec WhatsApp" },
              ]}
            />
          )}
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

          {phoneMode ? (
            <Field
              label="Numéro WhatsApp"
              hint="Ex. 0971234567 — notre équipe vous confirme sur WhatsApp."
            >
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0971234567"
                autoComplete="tel"
                required
              />
            </Field>
          ) : (
            <Field
              label={mode === "signin" ? "Email ou WhatsApp" : "Adresse email"}
              hint={
                mode === "signin"
                  ? "Votre email, ou votre numéro WhatsApp (ex. 0971234567)."
                  : undefined
              }
            >
              <Input
                type={mode === "signin" ? "text" : "email"}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={
                  mode === "signin" ? "vous@exemple.cd ou 0971234567" : "vous@exemple.cd"
                }
                autoComplete={mode === "signin" ? "username" : "email"}
                required
              />
            </Field>
          )}

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
              minLength={mode === "signup" ? 8 : undefined}
              required
            />
          </Field>

          <ApiErrorText error={error} />

          <Button type="submit" loading={busy} className="w-full">
            {mode === "signin" ? "Se connecter" : "Créer mon compte"}
          </Button>

          {phoneMode && (
            <p className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
              <MessageCircle className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
              Pas besoin d’email : après votre inscription, notre équipe vous
              appelle sur WhatsApp pour valider votre compte (gratuit).
            </p>
          )}
        </form>
      </div>
      </Reveal>

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 text-success" aria-hidden />
        Vos données restent dans votre organisation, isolées des autres clients.
      </p>
    </main>
  );
}
