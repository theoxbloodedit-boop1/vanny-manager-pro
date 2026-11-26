"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Inbox,
  KeyRound,
  LogOut,
  MailPlus,
  Store,
  Users,
} from "lucide-react";
import { signOut } from "@/lib/auth-client";
import {
  ApiErrorText,
  Avatar,
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
 * Coquille d'administration (Module A) : membres, invitations, succursales
 * et accès. Tout est chargé de l'organisation ACTIVE de la session — jamais
 * d'un id fourni par le navigateur.
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
  } | null;
  role?: string | null;
}
interface Member {
  id: string;
  userId: string;
  role: string;
  user: { id: string; name: string; email: string };
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

  // local form state
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState("cashier");
  const [invBranches, setInvBranches] = useState<string[]>([]);
  const [branchName, setBranchName] = useState("");
  const [branchAddress, setBranchAddress] = useState("");
  const [grantMember, setGrantMember] = useState("");
  const [grantBranch, setGrantBranch] = useState("");
  const [busy, setBusy] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const d = me.data;
    if (!me.isLoading && d && !d.authenticated) router.replace("/auth");
    if (!me.isLoading && d?.authenticated && !d.organization)
      router.replace("/post-auth");
  }, [me.data, me.isLoading, router]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["members"] });
    qc.invalidateQueries({ queryKey: ["branches"] });
    qc.invalidateQueries({ queryKey: ["org-invitations"] });
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
  const pendingCount = (orgInvites.data ?? []).filter((i) => i.status === "pending").length;

  return (
    <div className="min-h-screen bg-surface">
      {/* Barre supérieure */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Logo compact />
            <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-4 tracking-tight">{org.name}</p>
              <p className="text-[0.7rem] font-medium text-muted-foreground">
                {ROLE_LABELS[myRole] ?? myRole}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="hidden items-center gap-2 sm:flex">
              <Avatar name={me.data.user?.name ?? "?"} className="size-8" />
              <span className="max-w-36 truncate text-sm font-medium">
                {me.data.user?.name}
              </span>
            </span>
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
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        {/* Identité organisation */}
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <Badge tone="primary">{org.businessSector || "—"}</Badge>
          <Badge>{org.baseCurrency}</Badge>
          <Badge tone="success">Espace isolé</Badge>
        </div>

        {/* Vue d'ensemble */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat
            label="Membres"
            value={members.data?.length ?? "—"}
            icon={Users}
          />
          <Stat
            label="Succursales"
            value={branches.data?.length ?? "—"}
            icon={Store}
            tone="neutral"
          />
          {canSeeInvites ? (
            <Stat
              label="Invitations en attente"
              value={orgInvites.data ? pendingCount : "—"}
              icon={Inbox}
              tone={pendingCount > 0 ? "warning" : "neutral"}
            />
          ) : (
            <Stat
              label="Votre rôle"
              value={ROLE_LABELS[myRole] ?? myRole}
              icon={KeyRound}
              tone="neutral"
            />
          )}
        </div>

        <div className="space-y-5">
          {canManage && (
            <Card
              title="Membres"
              subtitle="Les rôles s’appliquent immédiatement, sans reconnexion."
              icon={Users}
            >
              {members.isLoading ? (
                <div className="flex justify-center py-4">
                  <Spinner />
                </div>
              ) : (members.data?.length ?? 0) === 0 ? (
                <EmptyState
                  icon={Users}
                  title="Aucun membre"
                  hint="Invitez votre première équipe ci-dessous."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {members.data?.map((m) => (
                    <li
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={m.user.name} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {m.user.name}
                            {m.userId === me.data.user?.id ? " (vous)" : ""}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {m.user.email}
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
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                        {m.role.includes("owner") && (
                          <option value={m.role}>
                            {ROLE_LABELS.owner}
                          </option>
                        )}
                      </select>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {canManage && (
            <Card
              title="Inviter une personne"
              subtitle="L’invité doit vérifier son email avant d’accepter."
              icon={MailPlus}
            >
              <div className="space-y-3">
                <Field label="Email de l’invité">
                  <Input
                    type="email"
                    value={invEmail}
                    onChange={(e) => setInvEmail(e.target.value)}
                    placeholder="collegue@exemple.cd"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Rôle">
                    <Select
                      value={invRole}
                      onChange={(e) => setInvRole(e.target.value)}
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Succursales">
                    <div className="space-y-1 pt-1">
                      {branches.data?.map((b) => (
                        <label
                          key={b.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={invBranches.includes(b.id)}
                            onChange={(e) =>
                              setInvBranches((prev) =>
                                e.target.checked
                                  ? [...prev, b.id]
                                  : prev.filter((x) => x !== b.id),
                              )
                            }
                          />
                          {b.name}
                        </label>
                      ))}
                      {(branches.data ?? []).length === 0 && (
                        <span className="text-xs text-muted-foreground">
                          Créez d’abord une succursale.
                        </span>
                      )}
                    </div>
                  </Field>
                </div>
                <ApiErrorText error={errors.invite} />
                <Button
                  loading={busy === "invite"}
                  onClick={() =>
                    run(
                      "invite",
                      () =>
                        post("/api/invitations", {
                          email: invEmail,
                          role: invRole,
                          branchIds: invBranches,
                        }),
                      () => {
                        setInvEmail("");
                        setInvBranches([]);
                      },
                    )
                  }
                  className="w-full"
                >
                  Envoyer l’invitation
                </Button>
              </div>
            </Card>
          )}

          <Card
            title="Succursales"
            subtitle="Chaque succursale peut accueillir ses propres caisses plus tard."
            icon={Store}
          >
            <div className="space-y-4">
              {(branches.data?.length ?? 0) === 0 && !branches.isLoading ? (
                <EmptyState
                  icon={Store}
                  title="Aucune succursale"
                  hint="Ajoutez votre premier point de vente ci-dessous."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {branches.data?.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{b.name}</p>
                        {b.address ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {b.address}
                          </p>
                        ) : null}
                      </div>
                      {b.phone ? (
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {b.phone}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {canManage && (
                <div className="grid gap-3 rounded-control bg-surface p-3 sm:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <Input
                      value={branchName}
                      onChange={(e) => setBranchName(e.target.value)}
                      placeholder="Nom de la nouvelle succursale"
                    />
                    <Input
                      value={branchAddress}
                      onChange={(e) => setBranchAddress(e.target.value)}
                      placeholder="Adresse (facultatif)"
                    />
                  </div>
                  <div className="self-end">
                    <Button
                      variant="outline"
                      loading={busy === "branch"}
                      onClick={() =>
                        run(
                          "branch",
                          () =>
                            post("/api/branches", {
                              name: branchName,
                              address: branchAddress || undefined,
                            }),
                          () => {
                            setBranchName("");
                            setBranchAddress("");
                          },
                        )
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
            <Card
              title="Accès aux succursales"
              subtitle="Un membre ne travaille que dans les succursales qui lui sont assignées."
              icon={KeyRound}
            >
              <div className="grid grid-cols-2 gap-3">
                <Field label="Membre">
                  <Select
                    value={grantMember}
                    onChange={(e) => setGrantMember(e.target.value)}
                  >
                    <option value="">— choisir —</option>
                    {members.data?.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.user.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Succursale">
                  <Select
                    value={grantBranch}
                    onChange={(e) => setGrantBranch(e.target.value)}
                  >
                    <option value="">— choisir —</option>
                    {branches.data?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
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
                    run(
                      "grant",
                      () =>
                        post("/api/branches/access", {
                          branchId: grantBranch,
                          userId: grantMember,
                        }),
                      () => {
                        setGrantMember("");
                        setGrantBranch("");
                      },
                    )
                  }
                  className="w-full"
                >
                  Accorder l’accès
                </Button>
              </div>
            </Card>
          )}

          {canSeeInvites && (
            <Card
              title="Invitations en attente"
              subtitle="Seuls le propriétaire et l’administrateur voient cette liste."
              icon={Inbox}
            >
              {orgInvites.isLoading ? (
                <div className="flex justify-center py-4">
                  <Spinner />
                </div>
              ) : orgInvites.error ? (
                <p className="text-sm text-muted-foreground">
                  Votre rôle ne permet pas de gérer les invitations.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {orgInvites.data
                    ?.filter((i) => i.status === "pending")
                    .map((i) => (
                      <li
                        key={i.id}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{i.email}</p>
                          <p className="text-xs text-muted-foreground">
                            {ROLE_LABELS[i.role.split(",")[0] ?? ""] ?? i.role}
                          </p>
                        </div>
                        <Button
                          variant="danger"
                          loading={busy === `cancel-${i.id}`}
                          onClick={() =>
                            run(`cancel-${i.id}`, () =>
                              post("/api/invitations/cancel", {
                                invitationId: i.id,
                              }),
                            )
                          }
                        >
                          Annuler
                        </Button>
                      </li>
                    ))}
                  {(orgInvites.data?.filter((i) => i.status === "pending") ?? [])
                    .length === 0 && (
                    <li className="py-2.5 text-sm text-muted-foreground">
                      Aucune invitation en attente.
                    </li>
                  )}
                </ul>
              )}
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
