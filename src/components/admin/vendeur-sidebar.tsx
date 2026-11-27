"use client";

import {
  LayoutDashboard,
  LogOut,
  Package,
  Receipt,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/ui";

/**
 * ADR — SIDEBAR DU VENDEUR (tableau de bord vendeur).
 *
 * Navigation gauche du tableau de bord vendeur. Regroupe les sections
 * pertinentes pour un vendeur : vue d'ensemble, point de vente (POS),
 * mes ventes, clients, catalogue (lecture). Le lien "Point de vente"
 * ouvre l'écran de caisse complet (/sales).
 */

export type VendeurSection =
  | "overview"
  | "ventes"
  | "clients"
  | "catalogue";

interface NavItem {
  id: VendeurSection;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { id: "overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { id: "ventes", label: "Mes ventes", icon: Receipt },
  { id: "clients", label: "Clients", icon: Users },
  { id: "catalogue", label: "Catalogue", icon: Package },
];

export function VendeurSidebar({
  section,
  onNavigate,
  brandName,
  logoUrl,
  userName,
  onSignOut,
}: {
  section: VendeurSection;
  onNavigate: (s: VendeurSection) => void;
  brandName: string;
  logoUrl: string | null;
  userName: string;
  onSignOut: () => void;
}) {
  return (
    <aside className="hidden h-screen w-full flex-col border-r border-border bg-background lg:flex lg:w-64 lg:shrink-0">
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 border-b border-border px-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="size-8 rounded-control object-contain" />
        ) : (
          <Logo compact />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold tracking-tight">
            {brandName || "VANNY"}
          </p>
          <p className="text-[0.65rem] font-bold tracking-[0.18em] text-muted-foreground">
            ESPACE VENDEUR
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        <Link
          href="/sales"
          className="flex w-full items-center gap-3 rounded-control bg-primary-soft px-3 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-primary"
        >
          <Store className="size-4.5 shrink-0" aria-hidden />
          <span>Point de vente</span>
        </Link>
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-sm font-semibold transition-colors ${
                active
                  ? "bg-primary-soft text-primary"
                  : "text-muted-foreground hover:bg-surface hover:text-foreground"
              }`}
            >
              <Icon className="size-4.5 shrink-0" aria-hidden />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* User + sign out */}
      <div className="border-t border-border p-3">
        <div className="mb-2 flex items-center gap-2 rounded-control bg-surface px-3 py-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary">
            {userName.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{userName}</p>
            <p className="truncate text-[0.65rem] text-muted-foreground">
              Espace vendeur
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-surface hover:text-accent"
        >
          <LogOut className="size-4" aria-hidden />
          Déconnexion
        </button>
      </div>
    </aside>
  );
}

/** Navigation mobile — compacte sous lg. */
export function VendeurMobileNav({
  section,
  onNavigate,
}: {
  section: VendeurSection;
  onNavigate: (s: VendeurSection) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border bg-background p-2 lg:hidden">
      {NAV.map((item) => {
        const Icon = item.icon;
        const active = section === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-control px-3 py-2 text-xs font-semibold transition-colors ${
              active
                ? "bg-primary-soft text-primary"
                : "text-muted-foreground hover:bg-surface"
            }`}
          >
            <Icon className="size-3.5" aria-hidden />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
