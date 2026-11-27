"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  Building2,
  CheckCircle2,
  Mail,
  MessageCircle,
} from "lucide-react";
import { Badge, Button, Card, Logo, Spinner } from "@/components/ui";

/**
 * Post-authentication orchestrator (Module A).
 *
 * One place decides where a freshly-authenticated user goes:
 *   authenticated + org            → /admin
 *   authenticated, not verified    → verification panel
 *   verified + pending invitation  → accept invitation
 *   verified, no invitation, no org→ /onboarding
 *
 * The dev verification link is only offered when the server says it exists
 * (NODE_ENV !== production and the dev mail transport).
 */

interface Me {
  authenticated: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    /** ADR-0016: WhatsApp number for phone accounts. */
    phone?: string | null;
    /** ADR-0014/0016: operator-approved. */
    manuallyApproved?: boolean;
  };
  organization?: { name: string } | null;
  role?: string | null;
}

interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: string;
}

async function fetchMe(): Promise<Me> {
  const res = await fetch("/api/me", { cache: "no-store" });
  return (await res.json().catch(() => ({}))) as Me;
}

export default function PostAuthPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [devUrl, setDevUrl] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string>();

  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    refetchInterval: (query) =>
      query.state.data?.authenticated && !query.state.data.user?.emailVerified
        ? 4000
        : false,
  });

  const invitations = useQuery({
    queryKey: ["my-invitations"],
    queryFn: async (): Promise<Invitation[]> => {
      const res = await fetch("/api/invitations", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message);
      const data = (await res.json().catch(() => ({}))) as Invitation[];
      return data.filter((i) => i.status === "pending");
    },
    enabled: !!me?.user && !me?.organization,
  });

  // Already have an organization → straight to the admin shell.
  useEffect(() => {
    if (me?.authenticated && me.organization) router.replace("/admin");
    if (me && !me.authenticated) router.replace("/auth");
  }, [me, router]);

  const loadDevLink = useCallback(async () => {
    setNotice(undefined);
    try {
      const res = await fetch("/api/dev/verification-link", { cache: "no-store" });
      if (!res.ok) throw new Error("indisponible");
      const data = (await res.json().catch(() => ({}))) as { url: string };
      setDevUrl(data.url);
    } catch {
      setNotice(
        "Lien de vérification indisponible. Vérifiez votre boîte mail.",
      );
    }
  }, []);

  const recheckVerification = useCallback(async () => {
    setChecking(true);
    setNotice(undefined);
    try {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["my-invitations"] });
    } finally {
      setChecking(false);
    }
  }, [queryClient]);

  async function accept(inv: Invitation) {
    setChecking(true);
    setNotice(undefined);
    try {
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationId: inv.id }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message: string };
        throw new Error(data.message);
      }
      queryClient.setQueryData<Me>(["me"], (old) =>
        old ? { ...old, organization: { name: "Votre organisation" } } : old,
      );
      router.replace("/admin");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Erreur inattendue");
      setChecking(false);
    }
  }

  if (isLoading || !me) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner />
      </main>
    );
  }

  if (!me.authenticated) return null; // redirecting to /auth

  if (me.organization) return null; // redirecting to /admin

  const isPhoneUser = !!me.user?.phone;
  const verified = !!me.user?.emailVerified || !!me.user?.manuallyApproved;
  const hasInvitation = invitations.data && invitations.data.length > 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-5 p-6">
      <div className="flex justify-center">
        <Logo />
      </div>

      <header className="text-center">
        <h1 className="text-xl font-extrabold tracking-tight">
          Bonjour {me.user?.name?.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isPhoneUser ? me.user?.phone : me.user?.email}
        </p>
      </header>

      {!verified && !hasInvitation ? (
        isPhoneUser ? (
          <Card
            title="Votre compte est en attente"
            subtitle="Notre équipe confirme votre inscription sur WhatsApp, puis vous pourrez créer votre entreprise. Ceci prend quelques minutes."
            icon={MessageCircle}
          >
            <div className="space-y-3">
              <Button onClick={recheckVerification} loading={checking} className="w-full">
                <CheckCircle2 className="size-4" aria-hidden />
                J’ai été validé(e)
              </Button>
              {notice ? (
                <p className="text-sm text-muted-foreground">{notice}</p>
              ) : null}
            </div>
          </Card>
        ) : (
        <Card
          title="Vérifiez votre adresse email"
          subtitle="Nous vous avons envoyé un lien de confirmation. Il protège vos invitations et expire dans 24 heures."
          icon={Mail}
        >
          <div className="space-y-3">
            {devUrl ? (
              <Button onClick={() => (window.location.href = devUrl)}>
                Ouvrir le lien de vérification (dév.)
              </Button>
            ) : (
              <Button onClick={loadDevLink} variant="outline">
                Renvoyer le lien de vérification
              </Button>
            )}
            <Button
              onClick={recheckVerification}
              loading={checking}
              disabled={!!devUrl}
              className="w-full"
            >
              <CheckCircle2 className="size-4" aria-hidden />
              J’ai vérifié mon email
            </Button>
            {notice ? (
              <p className="text-sm text-muted-foreground">{notice}</p>
            ) : null}
          </div>
        </Card>
        )
      ) : invitations.isLoading ? (
        <Card title="Vos invitations" icon={Mail}>
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        </Card>
      ) : invitations.data && invitations.data.length > 0 ? (
        <Card
          title="Vous avez une invitation"
          subtitle="Un membre de votre équipe vous a invité."
          icon={BadgeCheck}
        >
          <div className="space-y-4">
            {invitations.data.map((inv) => (
              <div
                key={inv.id}
                className="rounded-control border border-border bg-surface p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">Rôle</span>
                  <Badge tone="primary">{inv.role}</Badge>
                </div>
                <p className="mb-3 text-xs leading-5 text-muted-foreground">
                  Invitation envoyée à {inv.email}. En acceptant, vous rejoignez
                  l’organisation.
                </p>
                <Button
                  onClick={() => accept(inv)}
                  loading={checking}
                  className="w-full"
                >
                  Accepter l’invitation
                </Button>
              </div>
            ))}
            {notice ? (
              <p className="text-sm text-accent">{notice}</p>
            ) : null}
            <Link
              href="/onboarding"
              className="block text-center text-sm font-semibold text-primary hover:underline"
            >
              Créer ma propre entreprise à la place
            </Link>
          </div>
        </Card>
      ) : (
        <Card
          title="Créez votre entreprise"
          subtitle="Vous n’avez pas encore d’organisation. Passons à la création."
          icon={Building2}
        >
          <Button
            onClick={() => router.replace("/onboarding")}
            className="w-full"
          >
            Commencer l’installation
          </Button>
        </Card>
      )}
    </main>
  );
}
