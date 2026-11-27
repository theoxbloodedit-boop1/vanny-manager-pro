"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Receipt,
  Package,
  Users,
  Store,
  ArrowRight,
  TrendingUp,
  Phone,
} from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Spinner,
  Stat,
} from "@/components/ui";
import { Reveal } from "@/components/motion";
import {
  VendeurMobileNav,
  VendeurSidebar,
  type VendeurSection,
} from "@/components/admin/vendeur-sidebar";
import { applyTheme, clearTheme, getStoredMode, type ThemeMode } from "@/themes/themes";
import { useBranding } from "@/lib/use-branding";
import { signOut } from "@/lib/auth-client";

/**
 * ADR — TABLEAU DE BORD VENDEUR.
 *
 * Console vendeur complète (pas seulement la caisse) : vue d'ensemble,
 * mes ventes, clients, catalogue. Le point de vente (/sales) reste
 * accessible en un clic via le sidebar. Redirige les vendeurs et caissiers
 * ici au lieu de /admin.
 */

interface Me {
  authenticated: boolean;
  user?: { name: string; email: string };
  organization?: {
    name: string;
    brandName?: string | null;
    logoUrl?: string | null;
    brandColor?: string | null;
    themeId?: string | null;
  } | null;
  role?: string | null;
}
interface SaleRow {
  id: string;
  sellerName: string | null;
  totalMinor: string;
  currency: string;
  paymentMethod: string;
  createdAt: string;
}
interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  creditMinor: string;
}
interface ProductRow {
  id: string;
  name: string;
  categoryName?: string | null;
  priceUsdMinor?: number | null;
  priceCdfMinor?: number | null;
  totalStock?: number | null;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Requête impossible");
  return data as T;
}

function formatAmount(minor: number, currency: string): string {
  return `${new Intl.NumberFormat("fr-FR").format(minor)} ${currency}`;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Espèces",
  card: "Carte",
  credit: "Crédit",
  transfer: "Virement",
};

export default function VendeurPage() {
  const router = useRouter();
  const [section, setSection] = useState<VendeurSection>("overview");

  const me = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => get<Me>("/api/me"),
  });

  const salesToday = useQuery<{ count: number; totalMinor: number }>({
    queryKey: ["vendeur-sales-today"],
    queryFn: () => get<{ count: number; totalMinor: number }>("/api/sales?stats=today"),
    enabled: !!me.data?.organization,
  });
  const salesList = useQuery<SaleRow[]>({
    queryKey: ["vendeur-sales-list"],
    queryFn: () => get<SaleRow[]>("/api/sales?limit=30"),
    enabled: !!me.data?.organization,
  });
  const customers = useQuery<CustomerRow[]>({
    queryKey: ["vendeur-customers"],
    queryFn: () => get<CustomerRow[]>("/api/customers"),
    enabled: !!me.data?.organization,
  });
  const products = useQuery<ProductRow[]>({
    queryKey: ["vendeur-products"],
    queryFn: () => get<ProductRow[]>("/api/products"),
    enabled: !!me.data?.organization,
  });

  const branding = useBranding(
    me.data?.organization
      ? {
          brandName: me.data.organization.brandName ?? null,
          logoUrl: me.data.organization.logoUrl ?? null,
          brandColor: me.data.organization.brandColor ?? null,
        }
      : undefined,
  );

  const themeMode = useState<ThemeMode>(getStoredMode)[0];
  useEffect(() => {
    const d = me.data;
    if (!me.isLoading && d && !d.authenticated) router.replace("/auth");
    if (!me.isLoading && d?.authenticated && !d.organization)
      router.replace("/post-auth");
  }, [me.data, me.isLoading, router]);

  const activeThemeId = me.data?.organization?.themeId ?? null;
  useEffect(() => {
    if (me.data?.organization) applyTheme(activeThemeId, themeMode);
    else clearTheme();
  }, [me.data?.organization, activeThemeId, themeMode]);

  if (me.isLoading || !me.data) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner />
      </main>
    );
  }
  if (!me.data.authenticated || !me.data.organization) return null;

  const org = me.data.organization;
  const userName = me.data.user?.name ?? "Vendeur";
  const brandName = org.brandName ?? org.name;
  const brandLogo: string | null = branding?.logoUrl ?? org.logoUrl ?? null;

  // Derniere devise/vente pour l'affichage des totaux (heuristique : CDF sauf evidence).
  const total = salesToday.data?.totalMinor ?? 0;
  const currency = salesList.data?.[0]?.currency ?? "CDF";

  return (
    <div className="flex min-h-screen bg-surface">
      <VendeurSidebar
        section={section}
        onNavigate={setSection}
        brandName={brandName}
        logoUrl={brandLogo}
        userName={userName}
        onSignOut={() => signOut().then(() => router.replace("/auth"))}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-background px-4 py-3 lg:px-6">
          <div className="flex items-center gap-2">
            <Store className="size-5 text-primary" />
            <h1 className="text-base font-extrabold tracking-tight">
              {section === "overview"
                ? "Tableau de bord vendeur"
                : section === "ventes"
                  ? "Mes ventes"
                  : section === "clients"
                    ? "Clients"
                    : "Catalogue"}
            </h1>
          </div>
          <Button
            variant="primary"
            className="h-9 px-4 text-xs"
            onClick={() => router.push("/sales")}
          >
            <Store className="size-4" /> Point de vente
          </Button>
        </header>
        <VendeurMobileNav section={section} onNavigate={setSection} />
        <main className="mx-auto w-full max-w-4xl flex-1 space-y-5 p-4 sm:p-6">
          {/* ============ SECTION : VUE D'ENSEMBLE ============ */}
          {section === "overview" && (
            <>
              <Reveal>
                <div className="grid grid-cols-2 gap-4">
                  <Stat
                    icon={Receipt}
                    label="Ventes aujourd'hui"
                    value={String(salesToday.data?.count ?? 0)}
                    tone="primary"
                  />
                  <Stat
                    icon={TrendingUp}
                    label={`Total vendu (${currency})`}
                    value={formatAmount(total, currency)}
                    tone="warning"
                  />
                </div>
              </Reveal>

              <Reveal delay={0.05}>
                <Card title="Accès rapide" subtitle="Allez à l'action souhaitée." icon={LayoutDashboard}>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => router.push("/sales")}
                      className="flex items-center justify-between rounded-control bg-surface-inset p-3 text-left transition-colors hover:bg-surface"
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        <Store className="size-4 text-primary" /> Nouvel achat
                      </span>
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSection("ventes")}
                      className="flex items-center justify-between rounded-control bg-surface-inset p-3 text-left transition-colors hover:bg-surface"
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        <Receipt className="size-4 text-primary" /> Voir mes ventes
                      </span>
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </button>
                  </div>
                </Card>
              </Reveal>

              <Reveal delay={0.1}>
                <Card title="Ventes récentes" icon={Receipt}>
                  {salesList.isLoading ? (
                    <div className="flex justify-center py-4"><Spinner /></div>
                  ) : (salesList.data?.length ?? 0) === 0 ? (
                    <EmptyState icon={Receipt} title="Aucune vente" hint="Enregistrez une vente au point de vente." />
                  ) : (
                    <ul className="divide-y divide-border">
                      {salesList.data?.slice(0, 8).map((s) => (
                        <li key={s.id} className="flex items-center justify-between py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{s.sellerName ?? "Vendeur"}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(s.createdAt).toLocaleString("fr-FR")} · {PAYMENT_LABELS[s.paymentMethod] ?? s.paymentMethod}
                            </p>
                          </div>
                          <span className="text-sm font-bold tabular-nums">{formatAmount(Number(s.totalMinor), s.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </Reveal>
            </>
          )}

          {/* ============ SECTION : MES VENTES ============ */}
          {section === "ventes" && (
            <Reveal>
              <Card title="Mes ventes" subtitle="Historique des ventes enregistrées." icon={Receipt}>
                {salesList.isLoading ? (
                  <div className="flex justify-center py-4"><Spinner /></div>
                ) : (salesList.data?.length ?? 0) === 0 ? (
                  <EmptyState icon={Receipt} title="Aucune vente" hint="Enregistrez une vente au point de vente." />
                ) : (
                  <ul className="divide-y divide-border">
                    {salesList.data?.map((s) => (
                      <li key={s.id} className="flex items-center justify-between py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{s.sellerName ?? "Vendeur"}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(s.createdAt).toLocaleString("fr-FR")} · {PAYMENT_LABELS[s.paymentMethod] ?? s.paymentMethod}
                          </p>
                        </div>
                        <span className="text-sm font-bold tabular-nums">{formatAmount(Number(s.totalMinor), s.currency)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Reveal>
          )}

          {/* ============ SECTION : CLIENTS ============ */}
          {section === "clients" && (
            <Reveal>
              <Card title="Clients" subtitle="Vos clients et leurs crédits." icon={Users}>
                {customers.isLoading ? (
                  <div className="flex justify-center py-4"><Spinner /></div>
                ) : (customers.data?.length ?? 0) === 0 ? (
                  <EmptyState icon={Users} title="Aucun client" hint="Les clients sont saisis lors de la vente." />
                ) : (
                  <ul className="divide-y divide-border">
                    {customers.data?.map((c) => (
                      <li key={c.id} className="flex items-center justify-between py-2.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={c.name} className="size-8" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{c.name}</p>
                            <p className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Phone className="size-3" /> {c.phone ?? "sans téléphone"}
                            </p>
                          </div>
                        </div>
                        {Number(c.creditMinor) > 0 ? (
                          <Badge tone="warning">Crédit : {formatAmount(Number(c.creditMinor), currency)}</Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Reveal>
          )}

          {/* ============ SECTION : CATALOGUE ============ */}
          {section === "catalogue" && (
            <Reveal>
              <Card title="Catalogue" subtitle="Produits disponibles à la vente (lecture)." icon={Package}>
                {products.isLoading ? (
                  <div className="flex justify-center py-4"><Spinner /></div>
                ) : (products.data?.length ?? 0) === 0 ? (
                  <EmptyState icon={Package} title="Aucun produit" hint="Le propriétaire crée les produits." />
                ) : (
                  <ul className="divide-y divide-border">
                    {products.data?.map((p) => (
                      <li key={p.id} className="flex items-center justify-between py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{p.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.categoryName ? `${p.categoryName} · ` : ""}stock {p.totalStock ?? "—"}
                          </p>
                        </div>
                        <span className="text-sm font-semibold tabular-nums">
                          {p.priceUsdMinor != null ? `${formatAmount(p.priceUsdMinor, "USD")}` : ""}
                          {p.priceUsdMinor != null && p.priceCdfMinor != null ? " / " : ""}
                          {p.priceCdfMinor != null ? formatAmount(p.priceCdfMinor, "CDF") : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Reveal>
          )}
        </main>
      </div>
    </div>
  );
}
