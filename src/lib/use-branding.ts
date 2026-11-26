"use client";

import { useEffect } from "react";

/**
 * ADR-0020 — tenant branding hook.
 *
 * Applies the organization's branding to the document shell:
 *   - brandColor : overrides the `--color-primary` (and derived) CSS
 *                   variables so the tenant's accent wins over the theme.
 *   - logoUrl / brandName : returned for the header/login to render.
 *
 * The theme (themeId) is applied separately by the existing theming code
 * (applyTheme). This hook ONLY handles the brand color override + returns
 * the brand identity for rendering. It is fail-closed: an invalid color is
 * ignored (theme accent shows through), never a crash.
 *
 * NOTE: no setState inside the effect — the identity is returned directly
 * from the props (the parent already has it); the effect only mutates the
 * DOM (CSS variables), which is the sanctioned side-effect pattern.
 */

export interface Branding {
  brandName: string | null;
  logoUrl: string | null;
  brandColor: string | null;
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Expand #RGB → #RRGGBB for a uniform 6-digit value. */
function expandHex(hex: string): string {
  if (hex.length === 4) {
    return "#" + hex.slice(1).split("").map((c) => c + c).join("");
  }
  return hex;
}

/** Compute derived shades (hover/active/faint) from a base hex. */
function shades(base: string) {
  const h = expandHex(base).replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const dark = (f: number) =>
    `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;
  const mix = (f: number) =>
    `rgb(${Math.round(r + (255 - r) * f)}, ${Math.round(g + (255 - g) * f)}, ${Math.round(b + (255 - b) * f)})`;
  return {
    base,
    hover: dark(0.88),
    active: dark(0.78),
    soft: mix(0.9),
    faint: mix(0.94),
  };
}

/**
 * Apply the brand color override to the document root and return the brand
 * identity for rendering. Safe to call with undefined (no org yet).
 */
export function useBranding(branding: Branding | undefined): Branding | null {
  const color = branding?.brandColor;

  useEffect(() => {
    const root = document.documentElement;
    if (!color || !HEX_RE.test(color)) {
      // No valid brand color → clear any override (theme accent shows).
      root.style.removeProperty("--color-primary");
      root.style.removeProperty("--color-primary-hover");
      root.style.removeProperty("--color-primary-active");
      root.style.removeProperty("--color-primary-soft");
      root.style.removeProperty("--color-primary-faint");
      return;
    }
    const s = shades(color);
    root.style.setProperty("--color-primary", s.base);
    root.style.setProperty("--color-primary-hover", s.hover);
    root.style.setProperty("--color-primary-active", s.active);
    root.style.setProperty("--color-primary-soft", s.soft);
    root.style.setProperty("--color-primary-faint", s.faint);
  }, [color]);

  return branding ?? null;
}
