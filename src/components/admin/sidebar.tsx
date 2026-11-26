"use client";

import {
  Boxes,
  LayoutDashboard,
  LogOut,
  Palette,
  Package,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/ui";

/**
 * ADR-0020 — ADMIN SIDEBAR.
 *
 * Left navigation for the redesigned dashboard. Gives the owner full,
 * one-tap control over every section. The active state is derived from the
 * `section` prop; the header brand (logo + name) is rendered by the shell.
 */

export type AdminSection =
  | "overview"
  | "catalog"
  | "stock"
  | "team"
  | "branches"
  | "branding";

interface NavItem {
  id: AdminSection;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { id: "overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { id: "catalog", label: "Catalogue", icon: Package },
  { id: "stock", label: "Stock", icon: Boxes },
  { id: "team", label: "Équipe", icon: Users },
  { id: "branches", label: "Succursales", icon: Store },
  { id: "branding", label: "Identité", icon: Palette },
];

export function AdminSidebar({
  section,
  onNavigate,
  brandName,
  logoUrl,
  userName,
  onSignOut,
}: {
  section: AdminSection;
  onNavigate: (s: AdminSection) => void;
  brandName: string;
  logoUrl: string | null;
  userName: string;
  onSignOut: () => void;
}) {
  return (
    <aside className="flex h-screen w-full flex-col border-r border-border bg-background lg:w-64 lg:shrink-0">
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
            MANAGER PRO
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
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
              Espace sécurisé
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

/** Mobile top bar — compact nav for small screens (sidebar hidden < lg). */
export function AdminMobileNav({
  section,
  onNavigate,
}: {
  section: AdminSection;
  onNavigate: (s: AdminSection) => void;
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
