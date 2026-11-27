"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Banknote,
  CalendarClock,
  CheckCircle2,
  PiggyBank,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  ApiErrorText,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  Spinner,
  Stat,
} from "@/components/ui";

/**
 * ADR-0022 — COFFRE-FORT (vault) panel.
 *
 * Lets the business accumulate money gradually to pay its obligations
 * (factures, loyer) at the end of the month — without stress. Permission-
 * gated: vault.view to read, vault.deposit to move money, vault.manage to
 * create/settle obligations.
 */

interface VaultData {
  summary: {
    balanceUsdMinor: number;
    balanceCdfMinor: number;
    openObligations: number;
    openObligationsUsdMinor: number;
    openObligationsCdfMinor: number;
    overdueObligations: number;
  };
  obligations: Array<{
    id: string;
    title: string;
    kind: string;
    amountMinor: number;
    currency: string;
    dueAt: string | null;
    paidMinor: number;
    status: string;
    note: string | null;
  }>;
  entries: Array<{
    id: string;
    kind: string;
    amountMinor: number;
    currency: string;
    note: string | null;
    createdAt: string;
  }>;
}

const KIND_LABELS: Record<string, string> = {
  expense: "Dépense",
  rent: "Loyer",
  invoice: "Facture",
  tax: "Impôt",
};

const ENTRY_LABELS: Record<string, string> = {
  deposit: "Dépôt",
  withdrawal: "Retrait",
  payment: "Paiement",
};

function money(amountMinor: number, currency: string) {
  return `${(amountMinor / 100).toLocaleString("fr-FR")} ${currency}`;
}

export function VaultPanel({ permissions }: { permissions: string[] }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const vault = useQuery({
    queryKey: ["vault"],
    queryFn: async (): Promise<VaultData> => {
      const res = await fetch("/api/vault", { cache: "no-store" });
      const data = (await res.json()) as VaultData & { message?: string };
      if (!res.ok) throw new Error(data.message || "Coffre inaccessible");
      return data;
    },
  });

  const canDeposit = permissions.includes("vault.deposit");
  const canManage = permissions.includes("vault.manage");

  async function post(path: string, body: unknown) {
    setBusy(path);
    setError(undefined);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(data.message || "Action impossible");
      await qc.invalidateQueries({ queryKey: ["vault"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(undefined);
    }
  }

  async function del(path: string) {
    setBusy(path);
    setError(undefined);
    try {
      const res = await fetch(path, { method: "DELETE" });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(data.message || "Action impossible");
      await qc.invalidateQueries({ queryKey: ["vault"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(undefined);
    }
  }

  const summary = vault.data?.summary;
  const obligations = vault.data?.obligations ?? [];
  const entries = vault.data?.entries ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-extrabold tracking-tight">Coffre-fort</h1>
        <p className="text-sm text-muted-foreground">
          Mettez petit à petit pour solder vos factures et loyers à la fin du
          mois — sans vous casser la tête.
        </p>
      </div>

      {vault.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <>
          {/* Balance */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Solde USD" value={summary ? money(summary.balanceUsdMinor, "USD") : "—"} icon={Banknote} tone="primary" />
            <Stat label="Solde CDF" value={summary ? money(summary.balanceCdfMinor, "CDF") : "—"} icon={Banknote} tone="neutral" />
            <Stat
              label="Obligations ouvertes"
              value={summary ? summary.openObligations : "—"}
              icon={CalendarClock}
              tone={summary && summary.overdueObligations > 0 ? "warning" : "neutral"}
            />
            <Stat
              label="En retard"
              value={summary ? summary.overdueObligations : "—"}
              icon={CalendarClock}
              tone={summary && summary.overdueObligations > 0 ? "warning" : "neutral"}
            />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            {/* Obligations */}
            <Card title="Obligations à solder" icon={CalendarClock}>
              <ObligationForm onSubmit={(b) => post("/api/vault/obligations", b)} disabled={!canManage || !!busy} />
              <ApiErrorText error={error} />
              <div className="mt-4 space-y-2.5">
                {obligations.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Aucune obligation. Créez une facture ou un loyer à payer.
                  </p>
                ) : (
                  obligations.map((o) => {
                    const remaining = o.amountMinor - o.paidMinor;
                    const pct = o.amountMinor > 0 ? Math.round((o.paidMinor / o.amountMinor) * 100) : 0;
                    return (
                      <div
                        key={o.id}
                        className="rounded-control border border-border bg-surface-raised p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">{o.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {KIND_LABELS[o.kind] ?? o.kind} · à payer {money(remaining, o.currency)}
                              {o.dueAt ? ` · échéance ${new Date(o.dueAt).toLocaleDateString("fr-FR")}` : ""}
                            </p>
                          </div>
                          {o.status === "paid" ? (
                            <Badge tone="success">Payé</Badge>
                          ) : (
                            <Badge tone={o.dueAt && new Date(o.dueAt) < new Date() ? "warning" : "neutral"}>
                              {o.dueAt && new Date(o.dueAt) < new Date() ? "En retard" : "En cours"}
                            </Badge>
                          )}
                        </div>
                        {/* progress */}
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-inset">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {money(o.paidMinor, o.currency)} de {money(o.amountMinor, o.currency)} déjà versé
                        </p>

                        {o.status !== "paid" && canDeposit && (
                          <div className="mt-2.5 flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              step={100}
                              placeholder={`Paiement (${o.currency})`}
                              id={`pay-${o.id}`}
                              className="w-full rounded-control border border-border bg-surface px-2.5 py-1.5 text-sm"
                            />
                            <Button
                              type="button"
                              className="min-h-10 px-2 text-xs"
                              loading={!!busy}
                              disabled={!!busy}
                              onClick={async () => {
                                const value = Number((document.getElementById(`pay-${o.id}`) as HTMLInputElement)?.value);
                                if (!value || value <= 0) return;
                                await post("/api/vault/pay", { obligationId: o.id, amountMinor: value });
                              }}
                            >
                              Payer
                            </Button>
                          </div>
                        )}
                        {canManage && o.status !== "paid" && (
                          <Button
                            type="button"
                            className="min-h-10 mt-2 px-2 text-xs"
                            variant="outline"
                            loading={!!busy}
                            disabled={!!busy}
                            onClick={() => post("/api/vault/obligations/" + o.id, {})}
                          >
                            <CheckCircle2 className="size-3.5" />
                            Régler en intégral
                          </Button>
                        )}
                        {canManage && (
                          <Button
                            type="button"
                            className="min-h-10 mt-2 px-2 text-xs text-danger"
                            variant="ghost"
                            loading={!!busy}
                            disabled={!!busy}
                            onClick={() => del("/api/vault/obligations/" + o.id)}
                          >
                            <Trash2 className="size-3.5" />
                            Supprimer
                          </Button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </Card>

            {/* Vault movements */}
            <Card title="Mouvements du coffre" icon={PiggyBank}>
              <VaultActions
                canDeposit={canDeposit}
                busy={!!busy}
                onDeposit={(b) => post("/api/vault/deposit", b)}
                onWithdraw={(b) => post("/api/vault/withdraw", b)}
              />
              <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
                {entries.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Aucun mouvement. Déposez de l’argent dans le coffre.
                  </p>
                ) : (
                  entries.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between rounded-control border border-border bg-surface-raised px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex size-7 items-center justify-center rounded-control ${
                            e.kind === "deposit"
                              ? "bg-success-soft text-success"
                              : e.kind === "payment"
                                ? "bg-primary-soft text-primary"
                                : "bg-danger-soft text-danger"
                          }`}
                        >
                          {e.kind === "deposit" ? <TrendingUp className="size-3.5" /> : e.kind === "payment" ? <Banknote className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                        </span>
                        <div>
                          <p className="text-sm font-semibold">
                            {ENTRY_LABELS[e.kind] ?? e.kind} · {money(e.amountMinor, e.currency)}
                          </p>
                          {e.note ? <p className="text-xs text-muted-foreground">{e.note}</p> : null}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(e.createdAt).toLocaleDateString("fr-FR")}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/** Deposit / withdraw quick actions. */
function VaultActions({
  canDeposit,
  busy,
  onDeposit,
  onWithdraw,
}: {
  canDeposit: boolean;
  busy: boolean;
  onDeposit: (b: { amountMinor: number; currency: "USD" | "CDF"; note: string | null }) => void;
  onWithdraw: (b: { amountMinor: number; currency: "USD" | "CDF"; note: string | null }) => void;
}) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "CDF">("USD");
  const [note, setNote] = useState("");

  function submit(kind: "deposit" | "withdraw") {
    const value = Math.round(Number(amount) * 100);
    if (!value || value <= 0) return;
    (kind === "deposit" ? onDeposit : onWithdraw)({
      amountMinor: value,
      currency,
      note: note || null,
    });
    setAmount("");
    setNote("");
  }

  if (!canDeposit) {
    return (
      <p className="py-3 text-sm text-muted-foreground">
        Vos permissions ne permettent pas d’effectuer des opérations sur le coffre.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          type="number"
          min={0.01}
          step={0.01}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Montant"
        />
        <Select
          value={currency}
          onChange={(e) => setCurrency(e.target.value as "USD" | "CDF")}
          className="w-28"
        >
          <option value="USD">USD</option>
          <option value="CDF">CDF</option>
        </Select>
      </div>
      <Field label="Note (optionnelle)">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. caisse du jour" maxLength={200} />
      </Field>
      <div className="flex gap-2">
        <Button type="button" className="min-h-10 px-2 text-xs" loading={busy} onClick={() => submit("deposit")}>
          <Plus className="size-3.5" />
          Déposer
        </Button>
        <Button type="button" className="min-h-10 px-2 text-xs" variant="outline" loading={busy} onClick={() => submit("withdraw")}>
          <TrendingDown className="size-3.5" />
          Retirer
        </Button>
      </div>
    </div>
  );
}

/** Create an obligation (facture, loyer, ...). */
function ObligationForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (b: {
    title: string;
    kind: "expense" | "rent" | "invoice" | "tax";
    amountMinor: number;
    currency: "USD" | "CDF";
    dueAt: string | null;
    note: string | null;
  }) => void;
  disabled: boolean;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"expense" | "rent" | "invoice" | "tax">("rent");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "CDF">("USD");
  const [dueAt, setDueAt] = useState("");

  function submit() {
    const value = Math.round(Number(amount) * 100);
    if (!title.trim() || !value || value <= 0) return;
    onSubmit({
      title: title.trim(),
      kind,
      amountMinor: value,
      currency,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      note: null,
    });
    setTitle("");
    setAmount("");
    setDueAt("");
  }

  return (
    <div className="space-y-3">
      <Field label="Nom de l’obligation">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Loyer novembre" />
      </Field>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="rent">Loyer</option>
          <option value="invoice">Facture</option>
          <option value="tax">Impôt</option>
          <option value="expense">Dépense</option>
        </Select>
        <Select value={currency} onChange={(e) => setCurrency(e.target.value as "USD" | "CDF")}>
          <option value="USD">USD</option>
          <option value="CDF">CDF</option>
        </Select>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          type="number"
          min={0.01}
          step={0.01}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Montant"
        />
        <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
      </div>
      <Button type="button" className="min-h-10 px-2 text-xs" loading={disabled} onClick={submit}>
        <Plus className="size-3.5" />
        Ajouter l’obligation
      </Button>
    </div>
  );
}
