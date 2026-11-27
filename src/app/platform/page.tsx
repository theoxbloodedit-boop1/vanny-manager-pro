"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Building2,
  LayoutDashboard,
  LogOut,
  Receipt,
  ShieldCheck,
  Users,
  Package,
  Store,
  type LucideIcon,
} from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { formatMinor } from "@/lib/money";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Logo,
  Select,
  Spinner,
  Stat,
} from "@/components/ui";

/**
 * PHASE 6.2 — PLATFORM ADMIN DASHBOARD (ADR-0019).
 *
 * The "SaaS admin" surface for the platform operator (your account,
 * theoxbloodedit@gmail.com). Four tabs:
 *   - Vue d'ensemble : platform-wide stats (orgs, members, branches,
 *     products, plan distribution, 30-day revenue).
 *   - Organisations : every tenant with a business summary + subscription,
 *     and a detail drill-down (members, branches, product count, billing).
 *   - Facturation : the append-only billing ledger + per-org subscription
 *     management (plan/status/seats/amount).
 *   - Audit : the platform-access log — proof that every cross-tenant read
 *     is recorded (the Phase-6.2 security gate).
 *
 * Every read and mutation is operator-gated server-side and audited. The UI
 * only renders what the server returns; the server is the source of truth.
 */

type Tab = "overview" | "organizations" | "billing" | "audit";

/* ------------------------------ types ------------------------------ */

interface Stats {
  totalOrgs: number;
  totalMembers: number;
  totalBranches: number;
  totalProducts: number;
  plans: Record<string, number>;
  revenue30dMinor: number;
}

interface OrgRow {
  orgId: string;
  name: string;
  slug: string;
  businessSector: string;
  baseCurrency: string;
  status: string;
  createdAt: string;
  memberCount: number;
  branchCount: number;
  productCount: number;
  subscription: {
    plan: string;
    status: string;
    interval: string;
    seats: number;
    amountMinor: number;
    currency: string;
    currentPeriodEnd: string;
  } | null;
}

interface OrgDetail {
  org: {
    id: string;
    name: string;
    slug: string;
    businessSector: string;
    baseCurrency: string;
    status: string;
    timezone: string;
    createdAt: string;
  };
  members: { userId: string; name: string; email: string; role: string; createdAt: string }[];
  branches: { id: string; name: string; isActive: boolean }[];
  productCount: number;
  subscription: {
    plan: string;
    status: string;
    interval: string;
    seats: number;
    amountMinor: number;
    currency: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  } | null;
  recentBilling: { action: string; reason: string; operatorId: string; at: string }[];
}

interface BillingEventRow {
  id: string;
  orgId: string;
  action: string;
  operatorId: string;
  reason: string;
  previousPlan: string | null;
  newPlan: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  previousSeats: number | null;
  newSeats: number | null;
  at: string;
}

interface AccessLogRow {
  id: string;
  operatorId: string;
  action: string;
  orgId: string | null;
  detail: string | null;
  at: string;
}

/* ----------------------------- helpers ----------------------------- */

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message || "Requête impossible");
  return data;
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => {
    const data = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) throw new Error(data.message || "Action impossible");
    return data;
  });
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

const PLAN_LABEL: Record<string, string> = {
  free: "Gratuit",
  pro: "Pro",
  enterprise: "Entreprise",
};

const STATUS_LABEL: Record<string, string> = {
  trialing: "Essai",
  active: "Actif",
  past_due: "En retard",
  canceled: "Résilié",
  suspended: "Suspendu",
};

function planBadgeTone(plan: string): "neutral" | "primary" | "warning" {
  if (plan === "enterprise") return "primary";
  if (plan === "pro") return "primary";
  return "neutral";
}

function statusBadgeTone(
  status: string,
): "neutral" | "primary" | "danger" | "success" | "warning" {
  if (status === "active") return "success";
  if (status === "trialing") return "primary";
  if (status === "past_due") return "warning";
  if (status === "suspended") return "warning";
  return "neutral";
}

/* ------------------------------ page ------------------------------ */

export default function PlatformPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");

  const stats = useQuery({
    queryKey: ["platform-stats"],
    queryFn: () => getJson<Stats>("/api/platform/stats"),
    refetchInterval: 15000,
  });

  const orgs = useQuery({
    queryKey: ["platform-orgs"],
    queryFn: () => getJson<{ organizations: OrgRow[]; total: number }>("/api/platform/organizations"),
    refetchInterval: 15000,
  });

  const billing = useQuery({
    queryKey: ["platform-billing"],
    queryFn: () => getJson<{ events: BillingEventRow[] }>("/api/platform/billing-events"),
    refetchInterval: 20000,
  });

  const audit = useQuery({
    queryKey: ["platform-audit"],
    queryFn: () => getJson<{ entries: AccessLogRow[] }>("/api/platform/access-log"),
    refetchInterval: 20000,
  });

  const [selectedOrg, setSelectedOrg] = useState<OrgRow | null>(null);
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string>();

  const [editing, setEditing] = useState(false);
  const [subPlan, setSubPlan] = useState("free");
  const [subStatus, setSubStatus] = useState("active");
  const [subSeats, setSubSeats] = useState(1);
  const [subReason, setSubReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  const tabs: { value: Tab; label: string; icon: LucideIcon }[] = [
    { value: "overview", label: "Vue d'ensemble", icon: LayoutDashboard },
    { value: "organizations", label: "Organisations", icon: Building2 },
    { value: "billing", label: "Facturation", icon: Receipt },
    { value: "audit", label: "Audit", icon: ShieldCheck },
  ];

  async function openOrg(org: OrgRow) {
    setSelectedOrg(org);
    setDetailLoading(true);
    setDetailError(undefined);
    setDetail(null);
    try {
      const d = await getJson<OrgDetail>(`/api/platform/organizations/${org.orgId}`);
      setDetail(d);
      if (d.subscription) {
        setSubPlan(d.subscription.plan);
        setSubStatus(d.subscription.status);
        setSubSeats(d.subscription.seats);
      }
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveSubscription() {
    if (!selectedOrg) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await postJson(`/api/platform/organizations/${selectedOrg.orgId}/subscription`, {
        plan: subPlan,
        status: subStatus,
        seats: subSeats,
        reason: subReason.trim() || "Modification de l'abonnement par l'opérateur",
      });
      setEditing(false);
      setSubReason("");
      await qc.invalidateQueries({ queryKey: ["platform-orgs"] });
      await qc.invalidateQueries({ queryKey: ["platform-billing"] });
      await openOrg(selectedOrg);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  // Non-operator (403/401) — server is the source of truth.
  if (stats.isError && orgs.isError) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-5 p-6">
        <div className="flex justify-center">
          <Logo />
        </div>
        <Card title="Accès réservé" subtitle="Cette page est réservée aux opérateurs de la plateforme." icon={ShieldCheck}>
          <Button variant="outline" className="w-full" onClick={() => router.replace("/")}>
            Retour à l’accueil
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Logo compact />
            <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-4 tracking-tight">
                Console plateforme
              </p>
              <p className="text-[0.7rem] font-medium text-muted-foreground">
                Administrateur SaaS
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

      <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => {
                    setTab(t.value);
                    if (t.value !== "organizations") setSelectedOrg(null);
                  }}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-control px-3.5 text-sm font-semibold transition-colors ${
                    tab === t.value
                      ? "bg-surface-raised text-foreground shadow-card"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4" aria-hidden />
                  {t.label}
                </button>
              );
            })}
          </div>
          <Badge tone="primary">Opérateur plateforme</Badge>
        </div>

        {/* ---------------- OVERVIEW ---------------- */}
        {tab === "overview" && (
          <div className="space-y-5">
            {stats.isLoading ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Organisations" value={stats.data?.totalOrgs ?? 0} icon={Building2} />
                  <Stat label="Membres" value={stats.data?.totalMembers ?? 0} icon={Users} />
                  <Stat label="Succursales" value={stats.data?.totalBranches ?? 0} icon={Store} />
                  <Stat label="Produits" value={stats.data?.totalProducts ?? 0} icon={Package} />
                  <Stat
                    label="CA 30 jours"
                    value={formatMinor(stats.data?.revenue30dMinor ?? 0, "USD")}
                    icon={Receipt}
                    tone="warning"
                  />
                  <Stat
                    label="Plans payants"
                    value={
                      (stats.data?.plans?.pro ?? 0) + (stats.data?.plans?.enterprise ?? 0)
                    }
                    icon={Receipt}
                  />
                </div>

                <Card title="Répartition des plans" subtitle="Distribution des abonnements par plan." icon={LayoutDashboard}>
                  <div className="space-y-3">
                    {(["free", "pro", "enterprise"] as const).map((plan) => {
                      const count = stats.data?.plans?.[plan] ?? 0;
                      const total =
                        (stats.data?.plans?.free ?? 0) +
                        (stats.data?.plans?.pro ?? 0) +
                        (stats.data?.plans?.enterprise ?? 0);
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <div key={plan} className="space-y-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-semibold">{PLAN_LABEL[plan]}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {count} · {pct}%
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-surface-inset">
                            <div
                              className={`h-full rounded-full ${
                                plan === "free"
                                  ? "bg-surface-inset"
                                  : plan === "pro"
                                    ? "bg-primary"
                                    : "bg-info"
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </>
            )}
          </div>
        )}

        {/* ---------------- ORGANIZATIONS ---------------- */}
        {tab === "organizations" && (
          <div className="space-y-5">
            <Card
              title="Organisations"
              subtitle="Toutes les boutiques/locataires de la plateforme. Cliquez pour détails."
              icon={Building2}
            >
              {orgs.isLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : (orgs.data?.organizations?.length ?? 0) === 0 ? (
                <EmptyState icon={Building2} title="Aucune organisation" hint="Les organisations apparaîtront ici." />
              ) : (
                <ul className="divide-y divide-border">
                  {orgs.data?.organizations?.map((o) => (
                    <li key={o.orgId}>
                      <button
                        type="button"
                        onClick={() => openOrg(o)}
                        className="flex w-full flex-wrap items-center justify-between gap-3 py-3 text-left"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{o.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {o.slug} · {o.businessSector} · {o.memberCount} membres · {o.branchCount} succ. · {o.productCount} produits
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {o.subscription ? (
                            <>
                              <Badge tone={planBadgeTone(o.subscription.plan)}>
                                {PLAN_LABEL[o.subscription.plan] ?? o.subscription.plan}
                              </Badge>
                              <Badge tone={statusBadgeTone(o.subscription.status)}>
                                {STATUS_LABEL[o.subscription.status] ?? o.subscription.status}
                              </Badge>
                            </>
                          ) : (
                            <Badge tone="neutral">Non abonné</Badge>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Detail */}
            {selectedOrg && (
              <Card
                title={selectedOrg.name}
                subtitle={`${selectedOrg.slug} · créé ${fmtDate(selectedOrg.createdAt)}`}
                icon={Building2}
                actions={
                  <Button variant="outline" className="min-h-10" onClick={() => setSelectedOrg(null)}>
                    Fermer
                  </Button>
                }
              >
                {detailLoading ? (
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                ) : detailError ? (
                  <p className="text-sm text-accent">{detailError}</p>
                ) : detail ? (
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Stat label="Secteurs" value={detail.org.businessSector} icon={Store} tone="neutral" />
                      <Stat label="Devise" value={detail.org.baseCurrency} icon={Receipt} tone="neutral" />
                      <Stat label="Produits" value={detail.productCount} icon={Package} tone="neutral" />
                      <Stat label="Succursales" value={detail.branches.length} icon={Store} tone="neutral" />
                    </div>

                    {/* Subscription / billing */}
                    <div className="rounded-control bg-surface-inset p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-sm font-bold">Abonnement</h3>
                        <Button className="min-h-10" onClick={() => setEditing((v) => !v)}>
                          {editing ? "Annuler" : "Modifier"}
                        </Button>
                      </div>

                      {!editing ? (
                        detail.subscription ? (
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            <div>
                              <p className="text-xs text-muted-foreground">Plan</p>
                              <p className="font-semibold">{PLAN_LABEL[detail.subscription.plan]}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Statut</p>
                              <p className="font-semibold">
                                {STATUS_LABEL[detail.subscription.status] ?? detail.subscription.status}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Sièges</p>
                              <p className="font-semibold tabular-nums">{detail.subscription.seats}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Prix</p>
                              <p className="font-semibold tabular-nums">
                                {formatMinor(detail.subscription.amountMinor, detail.subscription.currency as "USD" | "CDF")}
                                {` / ${detail.subscription.interval === "yearly" ? "an" : "mois"}`}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Période</p>
                              <p className="font-semibold tabular-nums">
                                jusqu’au {fmtDate(detail.subscription.currentPeriodEnd)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Intervalle</p>
                              <p className="font-semibold">
                                {detail.subscription.interval === "yearly" ? "Annuel" : "Mensuel"}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Aucun abonnement. Lancez un plan pour activer la facturation.
                          </p>
                        )
                      ) : (
                        <div className="space-y-3">
                          <Field label="Plan">
                            <Select value={subPlan} onChange={(e) => setSubPlan(e.target.value)}>
                              <option value="free">Gratuit</option>
                              <option value="pro">Pro</option>
                              <option value="enterprise">Entreprise</option>
                            </Select>
                          </Field>
                          <Field label="Statut">
                            <Select value={subStatus} onChange={(e) => setSubStatus(e.target.value)}>
                              <option value="trialing">Essai</option>
                              <option value="active">Actif</option>
                              <option value="past_due">En retard</option>
                              <option value="suspended">Suspendu</option>
                              <option value="canceled">Résilié</option>
                            </Select>
                          </Field>
                          <Field label="Sièges" hint="Nombre d'utilisateurs autorisés.">
                            <Input
                              type="number"
                              min={1}
                              value={subSeats}
                              onChange={(e) => setSubSeats(Number(e.target.value) || 1)}
                            />
                          </Field>
                          <Field label="Motif (consigné dans l'audit)" hint="Obligatoire pour la traçabilité.">
                            <Input
                              value={subReason}
                              onChange={(e) => setSubReason(e.target.value)}
                              minLength={4}
                              placeholder="Ex : Passage à l'offre Pro"
                            />
                          </Field>
                          {actionError ? <p className="text-sm text-accent">{actionError}</p> : null}
                          <Button loading={busy} className="w-full" onClick={saveSubscription}>
                            Enregistrer l’abonnement
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Members */}
                    <div>
                      <h3 className="mb-2 text-sm font-bold">Membres ({detail.members.length})</h3>
                      {detail.members.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Aucun membre.</p>
                      ) : (
                        <ul className="divide-y divide-border rounded-control border border-border">
                          {detail.members.map((m) => (
                            <li key={m.userId} className="flex items-center justify-between gap-3 py-2.5">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{m.name}</p>
                                <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                              </div>
                              <Badge tone="primary">{m.role}</Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Branches */}
                    <div>
                      <h3 className="mb-2 text-sm font-bold">Succursales ({detail.branches.length})</h3>
                      {detail.branches.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Aucune succursale.</p>
                      ) : (
                        <ul className="divide-y divide-border rounded-control border border-border">
                          {detail.branches.map((b) => (
                            <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                              <span className="text-sm font-semibold">{b.name}</span>
                              <Badge tone={b.isActive ? "success" : "neutral"}>
                                {b.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Recent billing */}
                    {detail.recentBilling.length > 0 && (
                      <div>
                        <h3 className="mb-2 text-sm font-bold">Factures récentes</h3>
                        <ul className="divide-y divide-border rounded-control border border-border">
                          {detail.recentBilling.map((b, i) => (
                            <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{b.action}</p>
                                <p className="truncate text-xs text-muted-foreground">{b.reason}</p>
                              </div>
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {fmtDate(b.at)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : null}
              </Card>
            )}
          </div>
        )}

        {/* ---------------- BILLING ---------------- */}
        {tab === "billing" && (
          <Card
            title="Registre de facturation"
            subtitle="Historique append-only des changements d'abonnement (plan, statut, sièges)."
            icon={Receipt}
          >
            {billing.isLoading ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : (billing.data?.events?.length ?? 0) === 0 ? (
              <EmptyState icon={Receipt} title="Aucune facture" hint="Les modifications d'abonnement apparaîtront ici." />
            ) : (
              <ul className="divide-y divide-border">
                {billing.data?.events?.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        <span className="text-primary">{b.action}</span>{" "}
                        <span className="font-normal text-muted-foreground">
                          · {b.reason}
                        </span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {b.previousPlan ? `${PLAN_LABEL[b.previousPlan] ?? b.previousPlan} → ${PLAN_LABEL[b.newPlan ?? ""] ?? b.newPlan ?? "?"}` : ""}
                        {b.previousStatus && b.newStatus ? ` · ${STATUS_LABEL[b.previousStatus] ?? b.previousStatus} → ${STATUS_LABEL[b.newStatus] ?? b.newStatus}` : ""}
                        {b.previousSeats !== null && b.newSeats !== null ? ` · ${b.previousSeats}→${b.newSeats} sièges` : ""}
                      </p>
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">{fmtDate(b.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {/* ---------------- AUDIT ---------------- */}
        {tab === "audit" && (
          <Card
            title="Journal d'accès plateforme"
            subtitle="Preuve que chaque lecture de données locataires est enregistrée (gate Phase-6.2)."
            icon={ShieldCheck}
          >
            {audit.isLoading ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : (audit.data?.entries?.length ?? 0) === 0 ? (
              <EmptyState icon={ShieldCheck} title="Aucun accès" hint="Les lectures de données locataires apparaîtront ici." />
            ) : (
              <ul className="divide-y divide-border">
                {audit.data?.entries?.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        <Badge tone={a.action === "org_detail" ? "warning" : "neutral"}>
                          {a.action === "org_detail" ? "Détail locataire" : "Liste locataires"}
                        </Badge>{" "}
                        <span className="font-normal text-muted-foreground">{a.detail}</span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        opérateur {a.operatorId.slice(0, 12)}… · org {a.orgId ?? "—"}
                      </p>
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">{fmtDate(a.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </main>
    </div>
  );
}
