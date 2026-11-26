"use client";

/**
 * ADR-0022 — ORGANIZATION SELECTOR (multi-activité).
 *
 * One account can belong to several businesses. This selector lets the user
 * switch the active organization in one tap; the whole dashboard re-reads
 * /api/me and re-applies the new tenant's theme + branding.
 *
 * Shown only when the account has more than one organization.
 */
import { useState } from "react";
import { Store } from "lucide-react";
import { Spinner } from "@/components/ui";

interface OrgOption {
  id: string;
  name: string;
  slug: string;
  businessSector: string;
  logoUrl: string | null;
  brandName: string | null;
  isActive: boolean;
}

export function OrgSelector({
  orgs,
  onSwitch,
}: {
  orgs: OrgOption[];
  onSwitch: (orgId: string) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<string>();
  if (orgs.length <= 1) return null;

  async function handle(id: string) {
    setBusy(id);
    try {
      await onSwitch(id);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs font-semibold text-muted-foreground sm:inline">
        Activité
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {orgs.map((o) => {
          const active = o.isActive;
          return (
            <button
              key={o.id}
              type="button"
              disabled={active || !!busy}
              onClick={() => handle(o.id)}
              className={`flex min-h-9 items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? "bg-primary text-white shadow-card"
                  : "border border-border bg-surface-raised text-muted-foreground hover:bg-surface"
              }`}
            >
              {o.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={o.logoUrl} alt="" className="size-4 rounded-control object-contain" />
              ) : (
                <Store className="size-3.5" aria-hidden />
              )}
              <span className="max-w-32 truncate">{o.brandName ?? o.name}</span>
              {busy === o.id ? <Spinner /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
