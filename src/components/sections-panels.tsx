"use client";

/**
 * Panels UI des sections manquantes du tableau de bord propriétaire :
 * dépenses, fournisseurs, appareils (synchronisation), journal d'activité.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Banknote,
  Truck,
  Smartphone,
  ScrollText,
  Plus,
  ShieldOff,
  Activity,
} from "lucide-react";
import {
  ApiErrorText,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
} from "@/components/ui";
import { getJson, postJson } from "@/lib/http-client";
import { formatMinor } from "@/lib/money";

/* ------------------------------- DÉPENSES ------------------------------ */

interface Expense {
  id: string;
  category: string;
  label: string;
  amountMinor: number;
  currency: string;
  note: string | null;
  createdAt: string;
}

export function ExpensePanel() {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "CDF">("CDF");
  const [category, setCategory] = useState("autres");
  const [error, setError] = useState("");

  const expenses = useQuery<Expense[]>({
    queryKey: ["expenses"],
    queryFn: () => getJson<Expense[]>("/api/expenses"),
  });

  async function add() {
    setError("");
    const amt = Number(amount);
    if (!label.trim()) return setError("Saisissez la description.");
    if (!amt || amt <= 0) return setError("Montant invalide.");
    try {
      await postJson("/api/expenses", {
        label: label.trim(),
        amountMinor: Math.round(amt * (currency === "USD" ? 100 : 1)),
        currency,
        category,
      });
      setLabel("");
      setAmount("");
      qc.invalidateQueries({ queryKey: ["expenses"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  return (
    <Card title="Dépenses" subtitle="Sorties d'argent hors caisse." icon={Banknote}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="Description">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. Loyer du mois" />
          </Field>
          <Field label="Catégorie">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="autres">Autres</option>
              <option value="loyer">Loyer</option>
              <option value="achats">Achats</option>
              <option value="salaire">Salaire</option>
              <option value="electricite">Électricité</option>
              <option value="eau">Eau</option>
              <option value="internet">Internet</option>
              <option value="marketing">Marketing</option>
            </Select>
          </Field>
          <Field label="Montant">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" inputMode="decimal" placeholder="0" />
          </Field>
          <Field label="Devise">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value as "USD" | "CDF")}>
              <option value="CDF">CDF</option>
              <option value="USD">USD</option>
            </Select>
          </Field>
        </div>
        <Button onClick={add}>
          <Plus className="size-4" /> Enregistrer la dépense
        </Button>
        <ApiErrorText error={error} />
      </div>

      <div className="mt-4">
        {expenses.isLoading ? (
          <div className="flex justify-center py-4"><Spinner /></div>
        ) : (expenses.data?.length ?? 0) === 0 ? (
          <EmptyState icon={Banknote} title="Aucune dépense" />
        ) : (
          <ul className="divide-y divide-border">
            {expenses.data?.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{e.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.category} · {new Date(e.createdAt).toLocaleDateString("fr-FR")}
                  </p>
                </div>
                <span className="font-bold tabular-nums">{formatMinor(e.amountMinor, e.currency as "USD" | "CDF")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/* ----------------------------- FOURNISSEURS ----------------------------- */

interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  createdAt: string;
}

export function SupplierPanel() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  const suppliers = useQuery<Supplier[]>({
    queryKey: ["suppliers"],
    queryFn: () => getJson<Supplier[]>("/api/suppliers"),
  });

  async function add() {
    setError("");
    if (!name.trim()) return setError("Saisissez le nom.");
    try {
      await postJson("/api/suppliers", { name: name.trim(), phone: phone.trim() || undefined });
      setName("");
      setPhone("");
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  return (
    <Card title="Fournisseurs" subtitle="Partenaires d'achat." icon={Truck}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="Nom">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Fournisseur A" />
          </Field>
          <Field label="Téléphone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+243 …" />
          </Field>
        </div>
        <Button onClick={add}>
          <Plus className="size-4" /> Ajouter le fournisseur
        </Button>
        <ApiErrorText error={error} />
      </div>

      <div className="mt-4">
        {suppliers.isLoading ? (
          <div className="flex justify-center py-4"><Spinner /></div>
        ) : (suppliers.data?.length ?? 0) === 0 ? (
          <EmptyState icon={Truck} title="Aucun fournisseur" />
        ) : (
          <ul className="divide-y divide-border">
            {suppliers.data?.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.phone ?? "sans téléphone"}</p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(s.createdAt).toLocaleDateString("fr-FR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/* --------------------- APPAREILS / SYNCHRONISATION ---------------------- */

interface Device {
  id: string;
  label: string;
  platform: string;
  lastSeenAt: string;
  revokedAt: string | null;
  branchId: string | null;
}

export function SyncPanel() {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");

  const devices = useQuery<Device[]>({
    queryKey: ["devices"],
    queryFn: () => getJson<Device[]>("/api/devices"),
  });

  async function register() {
    setError("");
    if (!label.trim()) return setError("Saisissez un nom d'appareil.");
    try {
      await postJson("/api/devices", { label: label.trim() });
      setLabel("");
      qc.invalidateQueries({ queryKey: ["devices"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function revoke(id: string) {
    try {
      await fetch(`/api/devices`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: id, action: "revoke" }),
      });
      qc.invalidateQueries({ queryKey: ["devices"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  return (
    <Card title="Appareils & synchronisation" subtitle="Registre des appareils de vente (ADR-0007)." icon={Smartphone}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nom de l'appareil (Ex. Samsung A5)" className="flex-1" />
          <Button onClick={register}>
            <Plus className="size-4" /> Autoriser
          </Button>
        </div>
        <ApiErrorText error={error} />
        <p className="text-xs text-muted-foreground">
          La synchronisation est authentifiée par appareil + membre. Un appareil révoqué est bloqué au prochain sync.
        </p>
      </div>

      <div className="mt-4">
        {devices.isLoading ? (
          <div className="flex justify-center py-4"><Spinner /></div>
        ) : (devices.data?.length ?? 0) === 0 ? (
          <EmptyState icon={Smartphone} title="Aucun appareil" hint="Autorisez un appareil pour la synchronisation." />
        ) : (
          <ul className="divide-y divide-border">
            {devices.data?.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {d.label}
                    {d.revokedAt ? (
                      <span className="ml-2 rounded-pill bg-accent/10 px-2 py-0.5 text-[0.65rem] font-bold text-accent">révoqué</span>
                    ) : (
                      <span className="ml-2 rounded-pill bg-success-soft px-2 py-0.5 text-[0.65rem] font-bold text-success">actif</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.platform} · dernier contact {new Date(d.lastSeenAt).toLocaleString("fr-FR")}
                  </p>
                </div>
                {!d.revokedAt && (
                  <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => revoke(d.id)}>
                    <ShieldOff className="size-3.5" /> Révoquer
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/* --------------------------- JOURNAL ACTIVITÉ --------------------------- */

interface ActivityRow {
  id: string;
  actorName: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export function ActivityPanel() {
  const activity = useQuery<ActivityRow[]>({
    queryKey: ["activity"],
    queryFn: () => getJson<ActivityRow[]>("/api/activity"),
  });

  return (
    <Card title="Journal d'activité" subtitle="Traçabilité des actions métier (append-only)." icon={ScrollText}>
      {activity.isLoading ? (
        <div className="flex justify-center py-4"><Spinner /></div>
      ) : (activity.data?.length ?? 0) === 0 ? (
        <EmptyState icon={ScrollText} title="Aucune activité" hint="Les actions métier sont enregistrées ici." />
      ) : (
        <ul className="divide-y divide-border">
          {activity.data?.map((a) => (
            <li key={a.id} className="flex items-start gap-2 py-2 text-sm">
              <Activity className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="font-semibold">{a.action}</p>
                <p className="text-xs text-muted-foreground">
                  {a.actorName ?? "—"} · {new Date(a.createdAt).toLocaleString("fr-FR")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
