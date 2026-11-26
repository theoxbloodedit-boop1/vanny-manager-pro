"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Inbox,
  MailPlus,
  MessageCircle,
  Palette,
  Store,
  Users,
  Boxes,
  Package,
  KeyRound,
} from "lucide-react";
import { signOut } from "@/lib/auth-client";
import {
  buildInviteAppUrl,
  buildInviteMessage,
  buildWhatsAppUrl,
  normalizeWaPhone,
} from "@/server/invite-link";
import {
  ApiErrorText,
  Avatar,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Segmented,
  Spinner,
  Stat,
} from "@/components/ui";
import {
  applyTheme,
  clearTheme,
  getStoredMode,
  storeMode,
  THEMES,
  THEME_IDS,
  type ThemeMode,
} from "@/themes/themes";
import { useBranding } from "@/lib/use-branding";
import { CatalogPanel } from "@/components/catalog-panel";
import { StockPanel } from "@/components/stock-panel";
import { CategoryManager } from "@/components/category-manager";
import { BrandingPanel } from "@/components/branding-panel";
import {
  AdminMobileNav,
  AdminSidebar,
  type AdminSection,
} from "@/components/admin/sidebar";

/**
 * ADR-0020 — ADMIN DASHBOARD (redesign).
 *
 * Sidebar-based console with full, one-tap control:
 *   overview → catalog → stock → team → branches → branding.
 * Every section is a focused panel; the shell applies the tenant's theme
 * (themeId) AND branding (logo / brand color / brand name) from /api/me.
 */

const ROLE_LABELS: Record<string, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  manager: "Manager",
  cashier: "Caissier",
  seller: "Vendeur",
  stock_manager: "Gestionnaire de stock",
  accountant: "Comptable",
};
const ASSIGNABLE_ROLES = Object.keys(ROLE_LABELS).filter((r) => r !== "owner");

interface Me {
  authenticated: boolean;
  user?: { id: string; name: string; email: string; emailVerified: boolean };
  organization?: {
    id: string;
    name: string;
    slug: string;
    businessSector: string;
    baseCurrency: string;
    themeId: string | null;
    brandName: string | null;
    logoUrl: string | null;
    brandColor: string | null;
  } | null;
  role?: string | null;
}
interface Member {
  id: string;
  userId: string;
  role: string;
  user: { id: string; name: string; email: string; phone?: string | null };
}
interface Branch {
  id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
}
interface OrgInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const data = (await res.json()) as T & { message?: string };
  if (!res.ok) throw new Error(data.message || "Requête impossible");
  return data;
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { message?: string };
  if (!res.ok) throw new Error(data.message || "Action impossible");
  return data;
}

export default function AdminPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [section, setSection] = useState<AdminSection>("overview");

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => get<Me>("/api/me"),
  });

  const members = useQuery({
    queryKey: ["members"],
    queryFn: () =>
      get<{ members: Member[]; total: number }>("/api/members").then(
        (d) => d.members,
      ),
    enabled: !!me.data?.organization,
  });
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => get<Branch[]>("/api/branches"),
    enabled: !!me.data?.organization,
  });
  const orgInvites = useQuery({
    queryKey: ["org-invitations"],
    queryFn: () => get<OrgInvitation[]>("/api/invitations/org"),
    enabled: !!me.data?.organization,
  });
  const products = useQuery({
    queryKey: ["products-count"],
    queryFn: () => get<{ total: number }>("/api/products?includeInactive=1"),
    enabled: !!me.data?.organization,
  });

  // Branding application (accent color override + brand identity).
  const branding = useBranding(
    me.data?.organization
      ? {
          brandName: me.data.organization.brandName,
          logoUrl: me.data.organization.logoUrl,
          brandColor: me.data.organization.brandColor,
        }
      : undefined,
  );

  // local form state
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState("cashier");
  const [invBranches, setInvBranches] = useState<string[]>([]);
  const [invPhone, setInvPhone] = useState("");
  const [lastInvite, setLastInvite] = useState<{
    email: string;
    phone: string | null;
  } | null>(null);
  const [waRow, setWaRow] = useState<string | null>(null);
  const orgName = me.data?.organization?.name ?? "VANNY";
  const [branchName, setBranchName] = useState("");
  const [branchAddress, setBranchAddress] = useState("");
  const [grantMember, setGrantMember] = useState("");
  const [grantBranch, setGrantBranch] = useState("");
  const [busy, setBusy] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [themeMode, setThemeMode] = useState<ThemeMode>(getStoredMode);
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

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["members"] });
    qc.invalidateQueries({ queryKey: ["branches"] });
    qc.invalidateQueries({ queryKey: ["org-invitations"] });
    qc.invalidateQueries({ queryKey: ["products-count"] });
    qc.invalidateQueries({ queryKey: ["me"] });
  }

  async function run(key: string, fn: () => Promise<unknown>, after?: () => void) {
    setBusy(key);
    setErrors((e) => ({ ...e, [key]: "" }));
    try {
      await fn();
      invalidate();
      after?.();
    } catch (err) {
      setErrors((e) => ({
        ...e,
        [key]: err instanceof Error ? err.message : "Erreur",
      }));
    } finally {
      setBusy(undefined);
    }
  }

  if (me.isLoading || !me.data) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner />
      </main>
    );
  }
  if (!me.data.authenticated || !me.data.organization) return null;

  const org = me.data.organization;
  const myRole = me.data.role ?? "member";
  const canManage = myRole === "owner" || myRole === "admin" || myRole === "manager";
  const canSeeInvites = myRole === "owner" || myRole === "admin";
  const canTheme = myRole === "owner";
  const pendingCount = (orgInvites.data ?? []).filter((i) => i.status === "pending").length;

  async function setTheme(themeId: string | null) {
    await run(
      "theme",
      () => post("/api/org/theme", { themeId }),
      () => {
        qc.invalidateQueries({ queryKey: ["me"] });
        applyTheme(themeId, themeMode);
      },
    );
  }

  function setDarkMode(mode: ThemeMode) {
    setThemeMode(mode);
    storeMode(mode);
  }

  const brandName = org.brandName ?? org.name;
  const brandLogo = branding?.logoUrl ?? org.logoUrl;

  return (
    <div className="flex min-h-screen bg-surface">
      {/* Desktop sidebar */}
      <AdminSidebar
        section={section}
        onNavigate={setSection}
        brandName={brandName}
        logoUrl={brandLogo}
        userName={me.data.user?.name ?? "?"}
        onSignOut={async () => {
          await signOut();
          router.replace("/auth");
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile nav */}
        <AdminMobileNav section={section} onNavigate={setSection} />

        <main className="mx-auto w-full max-w-4xl flex-1 space-y-5 p-4 sm:p-6">
          {/* ---- OVERVIEW ---- */}
          {section === "overview" && (
            <div className="space-y-5">
              <div>
                <h1 className="text-lg font-extrabold tracking-tight">
                  Vue d’ensemble
                </h1>
                <p className="text-sm text-muted-foreground">
                  {org.businessSector || "—"} · {org.baseCurrency} · espace isolé
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Membres" value={members.data?.length ?? "—"} icon={Users} />
                <Stat label="Succursales" value={branches.data?.length ?? "—"} icon={Store} tone="neutral" />
                <Stat label="Produits" value={products.data?.total ?? "—"} icon={Package} tone="neutral" />
                <Stat
                  label="Invitations"
                  value={canSeeInvites ? pendingCount : "—"}
                  icon={Inbox}
                  tone={pendingCount > 0 ? "warning" : "neutral"}
                />
              </div>
              <Card title="Accès rapide" subtitle="Allez à la section souhaitée." icon={KeyRound}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {(
                    [
                      { id: "catalog" as AdminSection, label: "Catalogue", icon: Package },
                      { id: "stock" as AdminSection, label: "Stock", icon: Boxes },
                      { id: "team" as AdminSection, label: "Équipe", icon: Users },
                      { id: "branches" as AdminSection, label: "Succursales", icon: Store },
                      { id: "branding" as AdminSection, label: "Identité", icon: Palette },
                      { id: "overview" as AdminSection, label: "Vue d’ensemble", icon: KeyRound },
                    ]
                  ).map((q) => {
                    const Icon = q.icon;
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => setSection(q.id)}
                        className="flex items-center gap-3 rounded-control border border-border bg-surface-raised p-3 text-left transition-colors hover:bg-surface-inset"
                      >
                        <span className="flex size-9 items-center justify-center rounded-control bg-primary-soft text-primary">
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <span className="text-sm font-semibold">{q.label}</span>
                      </button>
                    );
                  })}
                </div>
              </Card>
            </div>
          )}

          {/* ---- CATALOG ---- */}
          {section === "catalog" && (
            <div className="space-y-5">
              <div>
                <h1 className="text-lg font-extrabold tracking-tight">Catalogue</h1>
                <p className="text-sm text-muted-foreground">
                  Catégories, produits et services — prix USD et CDF indépendants.
                </p>
              </div>
              {canManage && <CategoryManager canEdit />}
              <CatalogPanel canEdit={myRole === "owner" || myRole === "admin"} />
            </div>
          )}

          {/* ---- STOCK ---- */}
          {section === "stock" && (
            <div className="space-y-5">
              <div>
                <h1 className="text-lg font-extrabold tracking-tight">Stock</h1>
                <p className="text-sm text-muted-foreground">
                  Positions par succursale, mouvements et transferts.
                </p>
              </div>
              <StockPanel
                canEdit={
                  myRole === "owner" ||
                  myRole === "admin" ||
                  myRole === "manager" ||
                  myRole === "stock_manager"
                }
              />
            </div>
          )}

          {/* ---- TEAM ---- */}
          {section === "team" && (
            <div className="space-y-5">
              <div>
                <h1 className="text-lg font-extrabold tracking-tight">Équipe</h1>
                <p className="text-sm text-muted-foreground">
                  Membres, rôles et invitations.
                </p>
              </div>
              {canManage && (
                <Card title="Membres" subtitle="Les rôles s'appliquent immédiatement, sans reconnexion." icon={Users}>
                  {members.isLoading ? (
                    <div className="flex justify-center py-4"><Spinner /></div>
                  ) : (members.data?.length ?? 0) === 0 ? (
                    <EmptyState icon={Users} title="Aucun membre" hint="Invitez votre première équipe ci-dessous." />
                  ) : (
                    <ul className="divide-y divide-border">
                      {members.data?.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar name={m.user.name} />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">
                                {m.user.name}
                                {m.userId === me.data.user?.id ? " (vous)" : ""}
                              </p>
                              <p className="truncate text-xs tabular-nums text-muted-foreground">
                                {m.user.phone ?? m.user.email}
                              </p>
                            </div>
                          </div>
                          <select
                            aria-label={`Rôle de ${m.user.name}`}
                            value={m.role.split(",")[0]}
                            disabled={myRole !== "owner" && myRole !== "admin"}
                            onChange={(e) =>
                              run("role", () =>
                                post("/api/members/role", {
                                  memberId: m.id,
                                  role: e.target.value,
                                }),
                              )
                            }
                            className="min-h-9 rounded-control border border-border bg-surface-raised px-2 text-sm font-medium disabled:opacity-50"
                          >
                            {ASSIGNABLE_ROLES.map((r) => (
                              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                            ))}
                            {m.role.includes("owner") && (
                              <option value={m.role}>{ROLE_LABELS.owner}</option>
                            )}
                          </select>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}

              {canManage && (
                <Card title="Inviter une personne" subtitle="L'invité reçoit le lien d'invitation — pas besoin de vérifier son email." icon={MailPlus}>
                  <div className="space-y-3">
                    <Field label="Email de l'invité">
                      <Input type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="collegue@exemple.cd" />
                    </Field>
                    <Field label="Numéro WhatsApp de l'invité (optionnel)" hint="Pour partager le lien d'invitation directement sur WhatsApp.">
                      <Input type="tel" value={invPhone} onChange={(e) => setInvPhone(e.target.value)} placeholder="+243 978 508 099" autoComplete="off" />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Rôle">
                        <Select value={invRole} onChange={(e) => setInvRole(e.target.value)}>
                          {ASSIGNABLE_ROLES.map((r) => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Succursales" hint="Optionnel — l'invité peut rejoindre sans succursale.">
                        <div className="space-y-1 pt-1">
                          {branches.data?.map((b) => (
                            <label key={b.id} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={invBranches.includes(b.id)}
                                onChange={(e) =>
                                  setInvBranches((prev) =>
                                    e.target.checked ? [...prev, b.id] : prev.filter((x) => x !== b.id),
                                  )
                                }
                              />
                              {b.name}
                            </label>
                          ))}
                          {(branches.data ?? []).length === 0 && (
                            <span className="text-xs text-muted-foreground">
                              Pas de succursale — l’invité rejoindra l’org sans accès succursale.
                            </span>
                          )}
                        </div>
                      </Field>
                    </div>
                    <ApiErrorText error={errors.invite} />
                    <Button
                      loading={busy === "invite"}
                      onClick={() => {
                        const email = invEmail;
                        const phone = normalizeWaPhone(invPhone);
                        run(
                          "invite",
                          () => post("/api/invitations", { email, role: invRole, branchIds: invBranches }),
                          () => {
                            setLastInvite({ email, phone });
                            setInvEmail("");
                            setInvPhone("");
                            setInvBranches([]);
                          },
                        );
                      }}
                      className="w-full"
                    >
                      Envoyer l’invitation
                    </Button>
                    {lastInvite && (
                      <div className="space-y-2 rounded-control border border-success/40 bg-surface-inset p-3">
                        <p className="text-sm leading-5 text-muted-foreground">
                          Invitation créée pour{" "}
                          <span className="font-semibold text-foreground">{lastInvite.email}</span>.
                          Partagez le lien d’invitation :
                        </p>
                        <ShareInviteControls
                          email={lastInvite.email}
                          orgName={orgName}
                          initialPhone={lastInvite.phone ?? ""}
                          onDone={() => setLastInvite(null)}
                        />
                      </div>
                    )}
                  </div>
                </Card>
              )}

              {canSeeInvites && (
                <Card title="Invitations en attente" subtitle="Seuls le propriétaire et l'administrateur voient cette liste." icon={Inbox}>
                  {orgInvites.isLoading ? (
                    <div className="flex justify-center py-4"><Spinner /></div>
                  ) : orgInvites.error ? (
                    <p className="text-sm text-muted-foreground">Votre rôle ne permet pas de gérer les invitations.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {orgInvites.data?.filter((i) => i.status === "pending").map((i) => (
                        <li key={i.id} className="py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{i.email}</p>
                              <p className="text-xs text-muted-foreground">
                                {ROLE_LABELS[i.role.split(",")[0] ?? ""] ?? i.role}
                              </p>
                            </div>
                            <div className="flex shrink-0 gap-2">
                              <Button
                                variant="outline"
                                className="min-h-9"
                                title="Partager le lien d'invitation sur WhatsApp"
                                aria-label={`Partager l'invitation de ${i.email} sur WhatsApp`}
                                onClick={() => setWaRow(waRow === i.id ? null : i.id)}
                              >
                                <MessageCircle className="size-4 text-success" aria-hidden />
                                <span className="hidden sm:inline">WhatsApp</span>
                              </Button>
                              <Button
                                variant="danger"
                                className="min-h-9"
                                loading={busy === `cancel-${i.id}`}
                                onClick={() =>
                                  run(`cancel-${i.id}`, () =>
                                    post("/api/invitations/cancel", { invitationId: i.id }),
                                  )
                                }
                              >
                                Annuler
                              </Button>
                            </div>
                          </div>
                          {waRow === i.id && (
                            <div className="mt-2 rounded-control bg-surface-inset p-3">
                              <ShareInviteControls email={i.email} orgName={orgName} onDone={() => setWaRow(null)} />
                            </div>
                          )}
                        </li>
                      ))}
                      {(orgInvites.data?.filter((i) => i.status === "pending") ?? []).length === 0 && (
                        <li className="py-2.5 text-sm text-muted-foreground">Aucune invitation en attente.</li>
                      )}
                    </ul>
                  )}
                </Card>
              )}
            </div>
          )}

          {/* ---- BRANCHES ---- */}
          {section === "branches" && (
            <div className="space-y-5">
              <div>
                <h1 className="text-lg font-extrabold tracking-tight">Succursales</h1>
                <p className="text-sm text-muted-foreground">
                  Points de vente et accès par membre.
                </p>
              </div>
              <Card title="Succursales" subtitle="Chaque succursale peut accueillir ses propres caisses plus tard." icon={Store}>
                <div className="space-y-4">
                  {(branches.data?.length ?? 0) === 0 && !branches.isLoading ? (
                    <EmptyState icon={Store} title="Aucune succursale" hint="Ajoutez votre premier point de vente ci-dessous." />
                  ) : (
                    <ul className="divide-y divide-border">
                      {branches.data?.map((b) => (
                        <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{b.name}</p>
                            {b.address ? <p className="truncate text-xs text-muted-foreground">{b.address}</p> : null}
                          </div>
                          {b.phone ? (
                            <span className="tabular-nums text-xs text-muted-foreground">{b.phone}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {canManage && (
                    <div className="grid gap-3 rounded-control bg-surface p-3 sm:grid-cols-[1fr_auto]">
                      <div className="space-y-2">
                        <Input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="Nom de la nouvelle succursale" />
                        <Input value={branchAddress} onChange={(e) => setBranchAddress(e.target.value)} placeholder="Adresse (facultatif)" />
                      </div>
                      <div className="self-end">
                        <Button
                          variant="outline"
                          loading={busy === "branch"}
                          onClick={() =>
                            run("branch", () => post("/api/branches", { name: branchName, address: branchAddress || undefined }), () => {
                              setBranchName("");
                              setBranchAddress("");
                            })
                          }
                        >
                          Ajouter
                        </Button>
                      </div>
                      <ApiErrorText error={errors.branch} />
                    </div>
                  )}
                </div>
              </Card>

              {canManage && (
                <Card title="Accès aux succursales" subtitle="Un membre ne travaille que dans les succursales qui lui sont assignées." icon={KeyRound}>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Membre">
                      <Select value={grantMember} onChange={(e) => setGrantMember(e.target.value)}>
                        <option value="">— choisir —</option>
                        {members.data?.map((m) => (
                          <option key={m.userId} value={m.userId}>{m.user.name}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Succursale">
                      <Select value={grantBranch} onChange={(e) => setGrantBranch(e.target.value)}>
                        <option value="">— choisir —</option>
                        {branches.data?.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="mt-3">
                    <ApiErrorText error={errors.grant} />
                    <Button
                      loading={busy === "grant"}
                      disabled={!grantMember || !grantBranch}
                      onClick={() =>
                        run("grant", () => post("/api/branches/access", { branchId: grantBranch, userId: grantMember }), () => {
                          setGrantMember("");
                          setGrantBranch("");
                        })
                      }
                      className="w-full"
                    >
                      Accorder l’accès
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* ---- BRANDING ---- */}
          {section === "branding" && (
            <div className="space-y-5">
              <div>
                <h1 className="text-lg font-extrabold tracking-tight">Identité</h1>
                <p className="text-sm text-muted-foreground">
                  Logo, nom de marque, couleur — et ton de l’espace.
                </p>
              </div>
              <BrandingPanel />
              {canTheme && (
                <Card title="Ton de l'espace" subtitle="Thème prédéfini. Appliqué à toute votre équipe ; le mode clair/sombre est propre à chacun." icon={Palette}>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold">Mode</span>
                      <Segmented
                        className="grid-cols-2"
                        value={themeMode}
                        onChange={(m) => setDarkMode(m as ThemeMode)}
                        options={[
                          { value: "light", label: "Clair" },
                          { value: "dark", label: "Sombre" },
                        ]}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => setTheme(null)}
                        disabled={busy === "theme"}
                        className={`rounded-control border p-3 text-left transition-colors ${
                          activeThemeId === null ? "border-primary ring-2 ring-primary-soft" : "border-border hover:bg-surface-inset"
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="size-4 rounded-full border border-border" style={{ background: "#ffffff" }} aria-hidden />
                          <span className="size-4 rounded-full border border-border" style={{ background: "#0b5cff" }} aria-hidden />
                          <span className="size-4 rounded-full border border-border" style={{ background: "#0b1220" }} aria-hidden />
                        </span>
                        <span className="mt-2 block text-sm font-semibold">Neutre</span>
                      </button>
                      {THEME_IDS.map((id) => {
                        const t = THEMES[id];
                        const active = activeThemeId === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setTheme(id)}
                            disabled={busy === "theme"}
                            className={`rounded-control border p-3 text-left transition-colors ${
                              active ? "border-primary ring-2 ring-primary-soft" : "border-border hover:bg-surface-inset"
                            }`}
                          >
                            <span className="flex h-9 items-center justify-center gap-1.5 rounded-control" style={{ background: t.swatch.bg }}>
                              <span className="size-4 rounded-full" style={{ background: t.swatch.accent }} aria-hidden />
                              <span className="size-4 rounded-full" style={{ background: t.swatch.text }} aria-hidden />
                            </span>
                            <span className="mt-2 block text-sm font-semibold">{t.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <ApiErrorText error={errors.theme} />
                  </div>
                </Card>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * ADR-0017 — Share an invitation over WhatsApp (option A, free, no backend).
 */
function ShareInviteControls({
  email,
  orgName,
  initialPhone = "",
  onDone,
}: {
  email: string;
  orgName: string;
  initialPhone?: string;
  onDone: () => void;
}) {
  const [phone, setPhone] = useState(initialPhone);
  const e164 = normalizeWaPhone(phone);

  function openWhatsApp() {
    if (!e164) return;
    const appUrl = buildInviteAppUrl(window.location.origin, email);
    const url = buildWhatsAppUrl(e164, buildInviteMessage(orgName, email, appUrl));
    window.open(url, "_blank", "noopener,noreferrer");
    onDone();
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        <Field label="Numéro WhatsApp de l'invité" hint="Le lien s'ouvre pré-rempli dans votre WhatsApp — appuyez sur envoyer.">
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+243 978 508 099" autoComplete="off" />
        </Field>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button onClick={openWhatsApp} disabled={!e164}>
          <MessageCircle className="size-4" aria-hidden />
          Ouvrir WhatsApp
        </Button>
        <Button variant="outline" onClick={onDone}>Fermer</Button>
      </div>
    </div>
  );
}
