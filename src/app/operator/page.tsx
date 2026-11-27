"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CheckCircle2,
  Inbox,
  KeyRound,
  LogOut,
  Mail,
  MessageCircle,
} from "lucide-react";
import { signOut } from "@/lib/auth-client";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Logo,
  Spinner,
} from "@/components/ui";

/**
 * ADR-0016 — Opérateur de la plateforme : validation des inscriptions WhatsApp.
 *
 * Page réservée (serveur-side : session + allowlist `PLATFORM_OPERATOR_EMAILS`).
 * Chaque action passe par le flux audité ADR-0014 (drapeau + ligne d'audit
 * append-only, une transaction). `emailVerified` n'est jamais touché.
 */

interface PendingUser {
  userId: string;
  name: string;
  phone: string;
  createdAt: string;
}
interface PendingEmailUser {
  userId: string;
  name: string;
  email: string;
  createdAt: string;
}
interface RecentApproval {
  userId: string;
  name: string;
  phone: string | null;
  email: string;
  action: string;
  reason: string;
  at: string;
}
interface Approvals {
  pending: PendingUser[];
  pendingEmail: PendingEmailUser[];
  recent: RecentApproval[];
}

async function fetchApprovals(): Promise<Approvals> {
  const res = await fetch("/api/operator/approvals", { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as Approvals & { message?: string };
  if (!res.ok) {
    const err = new Error(data.message || "Accès impossible") as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return data;
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

const DEFAULT_APPROVE_REASON = "Identité confirmée par WhatsApp";
const DEFAULT_REVOKE_REASON = "Annulation — erreur de validation";

/** Identity of the account being acted on: a WhatsApp number or an email. */
type Target = { phone?: string; email?: string };

export default function OperatorPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<{
    target: Target;
    key: string; // stable row key: "phone:<n>" or "email:<e>" or "recent:<id>"
    action: "approve" | "revoke";
  } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const { data, isLoading, error: fetchError } = useQuery({
    queryKey: ["operator-approvals"],
    queryFn: fetchApprovals,
    refetchInterval: 8000,
  });

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner />
      </main>
    );
  }

  // Non-operator (403/401) — the server is the source of truth.
  if (fetchError) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-5 p-6">
        <div className="flex justify-center">
          <Logo />
        </div>
        <Card
          title="Accès réservé"
          subtitle="Cette page est réservée aux opérateurs de la plateforme."
          icon={KeyRound}
        >
          <Button
            variant="outline"
            className="w-full"
            onClick={() => router.replace("/")}
          >
            Retour à l’accueil
          </Button>
        </Card>
      </main>
    );
  }

  async function runAction(target: Target, action: "approve" | "revoke") {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/operator/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...target, action, reason }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message || "Action impossible");
      setConfirming(null);
      await qc.invalidateQueries({ queryKey: ["operator-approvals"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  const pending = data?.pending ?? [];
  const pendingEmail = data?.pendingEmail ?? [];
  const recent = data?.recent ?? [];
  const totalPending = pending.length + pendingEmail.length;

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Logo compact />
            <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-4 tracking-tight">
                Validation des inscriptions
              </p>
              <p className="text-[0.7rem] font-medium text-muted-foreground">
                Opérateur de la plateforme
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            className="min-h-10"
            onClick={async () => {
              await signOut();
              router.replace("/auth");
            }}
          >
            <LogOut className="size-4" aria-hidden />
            <span className="hidden sm:inline">Déconnexion</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="primary">Compte opérateur</Badge>
          <Badge tone={totalPending > 0 ? "warning" : "success"}>
            {totalPending} en attente
          </Badge>
        </div>

        <Card
          title="En attente de validation — WhatsApp"
          subtitle="Le client s’est inscrit avec son numéro WhatsApp. Confirmez son identité (appel WhatsApp), puis validez."
          icon={MessageCircle}
        >
          {pending.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Aucune attente"
              hint="Les nouvelles inscriptions WhatsApp apparaîtront ici."
            />
          ) : (
            <ul className="divide-y divide-border">
              {pending.map((u) => (
                <li key={u.userId} className="space-y-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{u.name}</p>
                      <p className="truncate text-xs tabular-nums text-muted-foreground">
                        {u.phone} · {fmtDate(u.createdAt)}
                      </p>
                    </div>
                    {confirming?.key === `phone:${u.phone}` ? null : (
                      <Button
                        className="min-h-10"
                        onClick={() => {
                          setReason(DEFAULT_APPROVE_REASON);
                          setError(undefined);
                          setConfirming({
                            target: { phone: u.phone },
                            key: `phone:${u.phone}`,
                            action: "approve",
                          });
                        }}
                      >
                        <CheckCircle2 className="size-4" aria-hidden />
                        Valider
                      </Button>
                    )}
                  </div>

                  {confirming?.key === `phone:${u.phone}` && (
                    <div className="space-y-2 rounded-control bg-surface-inset p-3">
                      <Field
                        label="Motif (consigné dans l’audit)"
                        hint="Modifiable — obligatoire pour la traçabilité."
                      >
                        <Input
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          minLength={4}
                        />
                      </Field>
                      {error ? (
                        <p className="text-sm text-accent">{error}</p>
                      ) : null}
                      <div className="flex gap-2">
                        <Button
                          loading={busy}
                          disabled={reason.trim().length < 4}
                          onClick={() =>
                            runAction({ phone: u.phone }, confirming.action)
                          }
                          className="flex-1"
                        >
                          Confirmer la {confirming.action === "approve" ? "validation" : "révocation"}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setConfirming(null)}
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="En attente de validation — email"
          subtitle="Personne invitée (lien WhatsApp ou email) qui a créé son compte avec l’email invité. Confirmez son identité, puis validez pour qu’elle puisse accepter l’invitation."
          icon={Mail}
        >
          {pendingEmail.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Aucune attente"
              hint="Les comptes email invités non vérifiés apparaîtront ici."
            />
          ) : (
            <ul className="divide-y divide-border">
              {pendingEmail.map((u) => (
                <li key={u.userId} className="space-y-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{u.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {u.email} · {fmtDate(u.createdAt)}
                      </p>
                    </div>
                    {confirming?.key === `email:${u.email}` ? null : (
                      <Button
                        className="min-h-10"
                        onClick={() => {
                          setReason(
                            "Identité confirmée — invité d’organisation",
                          );
                          setError(undefined);
                          setConfirming({
                            target: { email: u.email },
                            key: `email:${u.email}`,
                            action: "approve",
                          });
                        }}
                      >
                        <CheckCircle2 className="size-4" aria-hidden />
                        Valider
                      </Button>
                    )}
                  </div>

                  {confirming?.key === `email:${u.email}` && (
                    <div className="space-y-2 rounded-control bg-surface-inset p-3">
                      <Field
                        label="Motif (consigné dans l’audit)"
                        hint="Modifiable — obligatoire pour la traçabilité."
                      >
                        <Input
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          minLength={4}
                        />
                      </Field>
                      {error ? (
                        <p className="text-sm text-accent">{error}</p>
                      ) : null}
                      <div className="flex gap-2">
                        <Button
                          loading={busy}
                          disabled={reason.trim().length < 4}
                          onClick={() =>
                            runAction({ email: u.email }, confirming.action)
                          }
                          className="flex-1"
                        >
                          Confirmer la{" "}
                          {confirming.action === "approve"
                            ? "validation"
                            : "révocation"}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setConfirming(null)}
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Actions récentes"
          subtitle="Historique des validations et révocations (registre append-only)."
          icon={Inbox}
        >
          {recent.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              Aucune action pour l’instant.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((a) => (
                <li
                  key={`${a.userId}-${a.at}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {a.name}{" "}
                      <span className="font-normal tabular-nums text-muted-foreground">
                        · {a.phone ?? a.email}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      <span
                        className={
                          a.action === "approve" ? "text-success" : "text-accent"
                        }
                      >
                        {a.action === "approve" ? "Validé" : "Révoqué"}
                      </span>{" "}
                      — {a.reason} · {fmtDate(a.at)}
                    </p>
                  </div>
                  {a.action === "approve" && (
                    <Button
                      variant="danger"
                      className="min-h-8"
                      onClick={() => {
                        setReason(DEFAULT_REVOKE_REASON);
                        setError(undefined);
                        setConfirming({
                          target: a.phone ? { phone: a.phone } : { email: a.email },
                          key: `recent:${a.userId}`,
                          action: "revoke",
                        });
                      }}
                    >
                      Révoquer
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {confirming &&
          recent.some((r) => `recent:${r.userId}` === confirming.key) ? (
            <div className="mt-3 space-y-2 rounded-control bg-surface-inset p-3">
              <Field
                label="Motif de la révocation (consigné dans l’audit)"
                hint="Modifiable — obligatoire pour la traçabilité."
              >
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={4}
                />
              </Field>
              {error ? <p className="text-sm text-accent">{error}</p> : null}
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  loading={busy}
                  disabled={reason.trim().length < 4}
                  onClick={() =>
                    confirming && runAction(confirming.target, "revoke")
                  }
                  className="flex-1"
                >
                  Confirmer la révocation
                </Button>
                <Button variant="outline" onClick={() => setConfirming(null)}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      </main>
    </div>
  );
}
