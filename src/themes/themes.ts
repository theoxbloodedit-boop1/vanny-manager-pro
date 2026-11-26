/**
 * ADR-0015 — Tenant theming: the STATIC catalog of 12 tones × 2 modes
 * (light/dark) = 24 skins, distilled from the 32 reference mockups.
 *
 * Architecture (ADR-0015 D1): components consume ONLY semantic CSS tokens
 * (`bg-primary`, `text-muted-foreground`, …) — never a raw color. A theme is
 * a set of values for those tokens. Applying a theme = overriding the CSS
 * variables on `<html>`; resetting = removing the overrides (the neutral
 * design in `globals.css` @theme shows through). There is NO per-theme code
 * branch anywhere in the app, and NO user-uploaded assets in v1.
 *
 * Fail-closed (ADR-0015 D3/AC-3): an unknown `theme_id` resolves to `null`
 * → neutral render, never a 500.
 *
 * Single source of truth: this file drives BOTH the selector UI (labels +
 * swatches) and the rendered tokens.
 */

export type ThemeMode = "light" | "dark";

export type ThemeId =
  | "midnight-rose"
  | "ember-noir"
  | "crimson"
  | "violet-pulse"
  | "citron-studio"
  | "or-atelier"
  | "blanc-flag"
  | "blanc-signal"
  | "nature-verte"
  | "creme-live"
  | "violet-market"
  | "marche-orne";

export const THEME_IDS: ThemeId[] = [
  "midnight-rose",
  "ember-noir",
  "crimson",
  "violet-pulse",
  "citron-studio",
  "or-atelier",
  "blanc-flag",
  "blanc-signal",
  "nature-verte",
  "creme-live",
  "violet-market",
  "marche-orne",
];

/** Names shown in the selector UI (fr). */
export const THEME_LABELS: Record<ThemeId, string> = {
  "midnight-rose": "Minuit Rose",
  "ember-noir": "Braise Noir",
  crimson: "Cramoisi",
  "violet-pulse": "Pulsation Violette",
  "citron-studio": "Citron Studio",
  "or-atelier": "Or Atelier",
  "blanc-flag": "Drapeau Blanc",
  "blanc-signal": "Signal Blanc",
  "nature-verte": "Nature Verte",
  "creme-live": "Crème Live",
  "violet-market": "Marché Violette",
  "marche-orne": "Marché Orné",
};

/**
 * One rendered skin = values for the app's semantic tokens. The keys map to
 * CSS variables via `TOKEN_CSS_VARS` (keep in sync with `globals.css` @theme).
 */
export interface TokenSet {
  bg: string;
  surface: string;
  raised: string;
  inset: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentHover: string;
  accentActive: string;
  accentSoft: string;
  accentFaint: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  info: string;
  infoSoft: string;
}

/** Token key → CSS custom property (the neutral set in globals.css). */
export const TOKEN_CSS_VARS: Record<keyof TokenSet, string> = {
  bg: "--color-background",
  surface: "--color-surface",
  raised: "--color-surface-raised",
  inset: "--color-surface-inset",
  border: "--color-border",
  borderStrong: "--color-border-strong",
  text: "--color-foreground",
  textMuted: "--color-muted-foreground",
  textFaint: "--color-faint-foreground",
  accent: "--color-primary",
  accentHover: "--color-primary-hover",
  accentActive: "--color-primary-active",
  accentSoft: "--color-primary-soft",
  accentFaint: "--color-primary-faint",
  danger: "--color-accent",
  dangerSoft: "--color-accent-soft",
  success: "--color-success",
  successSoft: "--color-success-soft",
  warning: "--color-warning",
  warningSoft: "--color-warning-soft",
  info: "--color-info",
  infoSoft: "--color-info-soft",
};

export interface ThemeDef {
  label: string;
  /** Three preview dots for the selector card: [background, accent, text]. */
  swatch: { bg: string; accent: string; text: string };
  light: TokenSet;
  dark: TokenSet;
}

/**
 * The catalog. Contrast note: `accent` must stay dark enough for the white
 * text used by primary buttons (lime/gold tones use their deep variant for
 * `accent`; the bright variant survives in `accentSoft`/hover context).
 */
export const THEMES: Record<ThemeId, ThemeDef> = {
  "midnight-rose": {
    label: THEME_LABELS["midnight-rose"],
    swatch: { bg: "#0c0711", accent: "#e6438a", text: "#f5effa" },
    dark: {
      bg: "#0c0711", surface: "#140d1c", raised: "#191024", inset: "#100a17",
      border: "#2b1f3a", borderStrong: "#3d2d52",
      text: "#f5effa", textMuted: "#b3a4c4", textFaint: "#7d6f92",
      accent: "#d1337a", accentHover: "#c02a6e", accentActive: "#9c2258",
      accentSoft: "#33162d", accentFaint: "#1d0f20",
      danger: "#f0565f", dangerSoft: "#3a1519",
      success: "#46c47f", successSoft: "#12301f",
      warning: "#e5a13d", warningSoft: "#33260f",
      info: "#4dabf7", infoSoft: "#102a3d",
    },
    light: {
      bg: "#ffffff", surface: "#fbf4fa", raised: "#ffffff", inset: "#f8eef6",
      border: "#ecdcec", borderStrong: "#d8c2d6",
      text: "#241322", textMuted: "#75607b", textFaint: "#a291a8",
      accent: "#cf2e77", accentHover: "#b92366", accentActive: "#941a50",
      accentSoft: "#fbe3ef", accentFaint: "#fdf4f9",
      danger: "#e03131", dangerSoft: "#fdecec",
      success: "#2b8a3e", successSoft: "#e6f6ea",
      warning: "#e8590c", warningSoft: "#fff0e0",
      info: "#1971c2", infoSoft: "#e7f3fb",
    },
  },
  "ember-noir": {
    label: THEME_LABELS["ember-noir"],
    swatch: { bg: "#0e0a06", accent: "#f0762b", text: "#faf3ea" },
    dark: {
      bg: "#0e0a06", surface: "#181109", raised: "#1e150b", inset: "#120d07",
      border: "#332615", borderStrong: "#4a3820",
      text: "#faf3ea", textMuted: "#c0ac93", textFaint: "#8a7860",
      accent: "#e5670f", accentHover: "#d15c0c", accentActive: "#ab4a0a",
      accentSoft: "#33200e", accentFaint: "#241708",
      danger: "#f0565f", dangerSoft: "#3a1519",
      success: "#51cf66", successSoft: "#12301d",
      warning: "#f5a623", warningSoft: "#33270e",
      info: "#4dabf7", infoSoft: "#102a3d",
    },
    light: {
      bg: "#fffdf9", surface: "#fff6ec", raised: "#ffffff", inset: "#fff3e4",
      border: "#f0e2d0", borderStrong: "#ddc7a8",
      text: "#221708", textMuted: "#7a6a52", textFaint: "#a99a84",
      accent: "#d95d13", accentHover: "#bf4f0d", accentActive: "#98400b",
      accentSoft: "#fde8d2", accentFaint: "#fdf3e6",
      danger: "#e03131", dangerSoft: "#fdecec",
      success: "#2f9e44", successSoft: "#e7f6ec",
      warning: "#b45309", warningSoft: "#fdf0dd",
      info: "#1971c2", infoSoft: "#e7f3fb",
    },
  },
  crimson: {
    label: THEME_LABELS.crimson,
    swatch: { bg: "#120a0a", accent: "#ef4444", text: "#faefef" },
    dark: {
      bg: "#120a0a", surface: "#1d1111", raised: "#241515", inset: "#170e0e",
      border: "#3d2020", borderStrong: "#553030",
      text: "#faefef", textMuted: "#c4a9a9", textFaint: "#927474",
      accent: "#dc2626", accentHover: "#c81e1e", accentActive: "#a31919",
      accentSoft: "#381616", accentFaint: "#2a1212",
      danger: "#f87171", dangerSoft: "#3d1a1a",
      success: "#46c47f", successSoft: "#12301f",
      warning: "#e5a13d", warningSoft: "#33260f",
      info: "#4dabf7", infoSoft: "#102a3d",
    },
    light: {
      bg: "#ffffff", surface: "#fdf1f1", raised: "#ffffff", inset: "#fbe9e9",
      border: "#f0dada", borderStrong: "#e0bfbf",
      text: "#261212", textMuted: "#7d5f5f", textFaint: "#a98d8d",
      accent: "#d92626", accentHover: "#c01f1f", accentActive: "#9c1818",
      accentSoft: "#fbdcdc", accentFaint: "#fdf5f5",
      danger: "#c92a2a", dangerSoft: "#fdecec",
      success: "#2b8a3e", successSoft: "#e6f6ea",
      warning: "#e8590c", warningSoft: "#fff0e0",
      info: "#1971c2", infoSoft: "#e7f3fb",
    },
  },
  "violet-pulse": {
    label: THEME_LABELS["violet-pulse"],
    swatch: { bg: "#0d0a16", accent: "#8b5cf6", text: "#f3f0fb" },
    dark: {
      bg: "#0d0a16", surface: "#151022", raised: "#1a142b", inset: "#110d1b",
      border: "#2e2350", borderStrong: "#44366e",
      text: "#f3f0fb", textMuted: "#b1a8cc", textFaint: "#7f769c",
      accent: "#7c4ded", accentHover: "#6d3fd8", accentActive: "#5a32b3",
      accentSoft: "#251b3d", accentFaint: "#1d1530",
      danger: "#f0565f", dangerSoft: "#3a1519",
      success: "#46c47f", successSoft: "#12301f",
      warning: "#e5a13d", warningSoft: "#33260f",
      info: "#4dabf7", infoSoft: "#102a3d",
    },
    light: {
      bg: "#ffffff", surface: "#f6f3fd", raised: "#ffffff", inset: "#f1ecfa",
      border: "#e5def5", borderStrong: "#d0c4ec",
      text: "#1d1528", textMuted: "#6e6485", textFaint: "#9d93b5",
      accent: "#6d3fd6", accentHover: "#5f34c0", accentActive: "#4d2a9c",
      accentSoft: "#ece4fb", accentFaint: "#f7f3fd",
      danger: "#e03131", dangerSoft: "#fdecec",
      success: "#2b8a3e", successSoft: "#e6f6ea",
      warning: "#b45309", warningSoft: "#fdf0dd",
      info: "#1971c2", infoSoft: "#e7f3fb",
    },
  },
  "citron-studio": {
    label: THEME_LABELS["citron-studio"],
    swatch: { bg: "#0d0e08", accent: "#84cc16", text: "#f6f7ee" },
    dark: {
      bg: "#0d0e08", surface: "#16180d", raised: "#1b1e10", inset: "#111209",
      border: "#33381a", borderStrong: "#4a5126",
      text: "#f6f7ee", textMuted: "#bcbf9f", textFaint: "#8b8f70",
      accent: "#5c940d", accentHover: "#52830b", accentActive: "#42690a",
      accentSoft: "#22300e", accentFaint: "#1a2408",
      danger: "#f0565f", dangerSoft: "#3a1519",
      success: "#46c47f", successSoft: "#12301f",
      warning: "#e5a13d", warningSoft: "#33260f",
      info: "#4dabf7", infoSoft: "#102a3d",
    },
    light: {
      bg: "#fdfef7", surface: "#f6fae6", raised: "#ffffff", inset: "#f2f7dc",
      border: "#e4ecc4", borderStrong: "#d2de9f",
      text: "#1c2110", textMuted: "#6b7052", textFaint: "#9a9f7e",
      accent: "#4f7f0f", accentHover: "#46700c", accentActive: "#3a5d0a",
      accentSoft: "#e9f2cf", accentFaint: "#f4f9e3",
      danger: "#e03131", dangerSoft: "#fdecec",
      success: "#2b8a3e", successSoft: "#e6f6ea",
      warning: "#b45309", warningSoft: "#fdf0dd",
      info: "#1971c2", infoSoft: "#e7f3fb",
    },
  },
  "or-atelier": {
    label: THEME_LABELS["or-atelier"],
    swatch: { bg: "#131009", accent: "#d4a017", text: "#f7f2e7" },
    dark: {
      bg: "#131009", surface: "#1c1810", raised: "#221d13", inset: "#17140c",
      border: "#3a3020", borderStrong: "#52452c",
      text: "#f7f2e7", textMuted: "#c2b294", textFaint: "#8f8266",
      accent: "#b08900", accentHover: "#977300", accentActive: "#7d5f00",
      accentSoft: "#33280f", accentFaint: "#272008",
      danger: "#f0565f", dangerSoft: "#3a1519",
      success: "#46c47f", successSoft: "#12301f",
      warning: "#e5a13d", warningSoft: "#33260f",
      info: "#4dabf7", infoSoft: "#102a3d",
    },
    light: {
      bg: "#fffdf8", surface: "#faf5e9", raised: "#ffffff", inset: "#f6efdd",
      border: "#e9dfc8", borderStrong: "#d9c9a3",
      text: "#241c0c", textMuted: "#77684a", textFaint: "#a5976f",
      accent: "#9c7400", accentHover: "#856300", accentActive: "#6d5100",
      accentSoft: "#f3e8c8", accentFaint: "#faf5e9",
      danger: "#e03131", dangerSoft: "#fdecec",
      success: "#2b8a3e", successSoft: "#e6f6ea",
      warning: "#b45309", warningSoft: "#fdf0dd",
      info: "#1971c2", infoSoft: "#e7f3fb",
    },
  },
  "blanc-flag": {
    label: THEME_LABELS["blanc-flag"],
    swatch: { bg: "#ffffff", accent: "#ea580c", text: "#231608" },
    dark: {
      bg: "#16100a", surface: "#201810", raised: "#261d12", inset: "#1a130b",
      border: "#3d2f1f", borderStrong: "#55422c",
      text: "#faf1e6", textMuted: "#c4ad94", textFaint: "#917f66",
      accent: "#f97316", accentHover: "#e5670f", accentActive: "#bf530c",
      accentSoft: "#3a2410", accentFaint: "#2d1c0c",
      danger: "#f0565f", dangerSoft: "#3a1519",
      success: "#51cf66", successSoft: "#12301d",
      warning: "#f5a623", warningSoft: "#33270e",
      info: "#4dabf7", infoSoft: "#102a3d",
    },
    light: {
      bg: "#ffffff", surface: "#fff7ef", raised: "#ffffff", inset: "#fef1e3",
      border: "#f3e0cf", borderStrong: "#e3c6a8",
      text: "#231608", textMuted: "#7a6552", textFaint: "#a9957e",
      accent: "#ea580c", accentHover: "#d14e0a", accentActive: "#a83f08",
      accentSoft: "#ffe3cd", accentFaint: "#fff6ec",
      danger: "#e03131", dangerSoft: "#fdecec",
      success: "#2b8a3e", successSoft: "#e6f6ea",
      warning: "#b45309", warningSoft: "#fdf0dd",
      info: "#1971c2", infoSoft: "#e7f3fb",
    },
  },
  "blanc-signal": {
    label: THEME_LABELS["blanc-signal"],
    swatch: { bg: "#ffffff", accent: "#0b5cff", text: "#0b1220" },
    dark: {
      bg: "#0b1220", surface: "#101a2c", raised: "#14203a", inset: "#0d1524",
      border: "#24365a", borderStrong: "#33497a",
      text: "#eef2fa", textMuted: "#9fadc6", textFaint: "#6e7f9e",
      accent: "#3d7eff", accentHover: "#2f6ae6", accentActive: "#2656c4",
      accentSoft: "#16294d", accentFaint: "#122142",
      danger: "#f0565f", dangerSoft: "#3a1519",
      success: "#46c47f", successSoft: "#12301f",
      warning: "#e5a13d", warningSoft: "#33260f",
      info: "#4dabf7", infoSoft: "#102a3d",
    },
    light: {
      // The current neutral design, as a selectable tone.
      bg: "#ffffff", surface: "#f6f8fc", raised: "#ffffff", inset: "#f1f4f9",
      border: "#e4e9f2", borderStrong: "#cbd5e1",
      text: "#0b1220", textMuted: "#5b6b81", textFaint: "#8b98ab",
      accent: "#0b5cff", accentHover: "#0a4fd6", accentActive: "#093fb0",
      accentSoft: "#eaf0ff", accentFaint: "#f4f7ff",
      danger: "#e5252c", dangerSoft: "#fdebec",
      success: "#12833b", successSoft: "#e9f7ef",
      warning: "#b45309", warningSoft: "#fdf3e7",
      info: "#0e7490", infoSoft: "#e6f5f9",
    },
  },
  "nature-verte": {
    label: THEME_LABELS["nature-verte"],
    swatch: { bg: "#fdfef8", accent: "#2f9e44", text: "#182209" },
    dark: {
      bg: "#0e130c", surface: "#161e12", raised: "#1a2416", inset: "#121a0e",
      border: "#2c3a24", borderStrong: "#3d4f31",
      text: "#f1f6ec", textMuted: "#b4c2a4", textFaint: "#83936f",
      accent: "#43bf57", accentHover: "#38ac4c", accentActive: "#2f8f3f",
      accentSoft: "#1a3520", accentFaint: "#152a18",
      danger: "#f0565f", dangerSoft: "#3a1519",
      success: "#46c47f", successSoft: "#12301f",
      warning: "#e5a13d", warningSoft: "#33260f",
      info: "#4dabf7", infoSoft: "#102a3d",
    },
    light: {
      bg: "#fdfef8", surface: "#f4f8ec", raised: "#ffffff", inset: "#eff5e4",
      border: "#e2ecd4", borderStrong: "#ccdbb4",
      text: "#182209", textMuted: "#5f6f4a", textFaint: "#8f9d7a",
      accent: "#2f9e44", accentHover: "#2a8a3c", accentActive: "#227031",
      accentSoft: "#e2f3e5", accentFaint: "#f2f8ea",
      danger: "#e03131", dangerSoft: "#fdecec",
      success: "#2b8a3e", successSoft: "#e6f6ea",
      warning: "#b45309", warningSoft: "#fdf0dd",
      info: "#1971c2", infoSoft: "#e7f3fb",
    },
  },
  "creme-live": {
    label: THEME_LABELS["creme-live"],
    swatch: { bg: "#fffaf2", accent: "#7048e8", text: "#251a10" },
    dark: {
      bg: "#15101a", surface: "#1e1726", raised: "#231b2d", inset: "#181221",
      border: "#372c47", borderStrong: "#4d3f63",
      text: "#f5f0fa", textMuted: "#c0b3cc", textFaint: "#8d7f9e",
      accent: "#8460f0", accentHover: "#7451dc", accentActive: "#6143bd",
      accentSoft: "#2c2145", accentFaint: "#241a3a",
      danger: "#f0565f", dangerSoft: "#3a1519",
      success: "#46c47f", successSoft: "#12301f",
      warning: "#e5a13d", warningSoft: "#33260f",
      info: "#4dabf7", infoSoft: "#102a3d",
    },
    light: {
      bg: "#fffaf2", surface: "#faf1e4", raised: "#ffffff", inset: "#f6ebdb",
      border: "#ecdcc4", borderStrong: "#dbc5a5",
      text: "#251a10", textMuted: "#7a6852", textFaint: "#a8977e",
      accent: "#7048e8", accentHover: "#6239d6", accentActive: "#4f2dae",
      accentSoft: "#ece4fc", accentFaint: "#f7f1fd",
      danger: "#e03131", dangerSoft: "#fdecec",
      success: "#2b8a3e", successSoft: "#e6f6ea",
      warning: "#b45309", warningSoft: "#fdf0dd",
      info: "#1971c2", infoSoft: "#e7f3fb",
    },
  },
  "violet-market": {
    label: THEME_LABELS["violet-market"],
    swatch: { bg: "#fbfaff", accent: "#6d28d9", text: "#1e1630" },
    dark: {
      bg: "#100c18", surface: "#191327", raised: "#1e172f", inset: "#140f1d",
      border: "#332852", borderStrong: "#473a6e",
      text: "#f3effb", textMuted: "#b3a8cc", textFaint: "#80759e",
      accent: "#9370f2", accentHover: "#8460e6", accentActive: "#6d4ad4",
      accentSoft: "#2c2148", accentFaint: "#221938",
      danger: "#f0565f", dangerSoft: "#3a1519",
      success: "#46c47f", successSoft: "#12301f",
      warning: "#e5a13d", warningSoft: "#33260f",
      info: "#4dabf7", infoSoft: "#102a3d",
    },
    light: {
      bg: "#fbfaff", surface: "#f5f2fd", raised: "#ffffff", inset: "#f0ecfa",
      border: "#e5def6", borderStrong: "#d2c8ee",
      text: "#1e1630", textMuted: "#6a5f85", textFaint: "#9c92b8",
      accent: "#6d28d9", accentHover: "#6021c2", accentActive: "#4d1a9c",
      accentSoft: "#ece3fb", accentFaint: "#f6f2fd",
      danger: "#e03131", dangerSoft: "#fdecec",
      success: "#2b8a3e", successSoft: "#e6f6ea",
      warning: "#b45309", warningSoft: "#fdf0dd",
      info: "#1971c2", infoSoft: "#e7f3fb",
    },
  },
  "marche-orne": {
    label: THEME_LABELS["marche-orne"],
    swatch: { bg: "#1a120b", accent: "#e8590c", text: "#f8efe3" },
    dark: {
      bg: "#1a120b", surface: "#241a10", raised: "#2a1f13", inset: "#1e150c",
      border: "#443319", borderStrong: "#5c4726",
      text: "#f8efe3", textMuted: "#c8b193", textFaint: "#96825f",
      accent: "#e8590c", accentHover: "#d14e0a", accentActive: "#ab3f08",
      accentSoft: "#3a2410", accentFaint: "#2e1d0c",
      danger: "#f0565f", dangerSoft: "#3a1519",
      success: "#51cf66", successSoft: "#12301d",
      warning: "#f5a623", warningSoft: "#33270e",
      info: "#4dabf7", infoSoft: "#102a3d",
    },
    light: {
      bg: "#fffaf4", surface: "#fdf1e5", raised: "#ffffff", inset: "#fbeadd",
      border: "#f1ddc8", borderStrong: "#e2c4a2",
      text: "#271808", textMuted: "#7c6547", textFaint: "#aa9372",
      accent: "#d9480f", accentHover: "#c13f0c", accentActive: "#9c330a",
      accentSoft: "#fde0cb", accentFaint: "#fdf2e7",
      danger: "#e03131", dangerSoft: "#fdecec",
      success: "#2b8a3e", successSoft: "#e6f6ea",
      warning: "#b45309", warningSoft: "#fdf0dd",
      info: "#1971c2", infoSoft: "#e7f3fb",
    },
  },
};

/** Type guard (app-side validation — ADR-0015 D3, no SQL CHECK). */
export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && (THEME_IDS as string[]).includes(v);
}

/**
 * Resolve a (themeId, mode) pair to its token set.
 * null / unknown → null (neutral render — fail-closed, never throws).
 */
export function resolveTheme(
  themeId: string | null | undefined,
  mode: ThemeMode,
): TokenSet | null {
  if (!themeId) return null;
  const def = THEMES[themeId as ThemeId];
  if (!def) return null;
  return mode === "dark" ? def.dark : def.light;
}

/** Token set → { "--color-*": value } for the CSS variables. */
export function tokenSetToCssVars(set: TokenSet): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, cssVar] of Object.entries(TOKEN_CSS_VARS)) {
    out[cssVar] = set[key as keyof TokenSet];
  }
  return out;
}

/**
 * Apply a theme by overriding the semantic CSS variables on `<html>`.
 * themeId null/unknown → `clearTheme()` (the neutral @theme shows through).
 * Client-only (guarded) — the app is a client-rendered shell.
 */
export function applyTheme(
  themeId: string | null | undefined,
  mode: ThemeMode,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const set = resolveTheme(themeId, mode);
  if (!set) {
    clearTheme();
    return;
  }
  for (const [cssVar, value] of Object.entries(tokenSetToCssVars(set))) {
    root.style.setProperty(cssVar, value);
  }
}

/** Remove every token override → neutral design (globals.css @theme). */
export function clearTheme(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const cssVar of Object.values(TOKEN_CSS_VARS)) {
    root.style.removeProperty(cssVar);
  }
}

/** localStorage helpers for the per-device light/dark mode preference. */
const MODE_STORAGE_KEY = "vanny-theme-mode";

export function getStoredMode(): ThemeMode {
  if (typeof localStorage === "undefined") return "light";
  return localStorage.getItem(MODE_STORAGE_KEY) === "dark" ? "dark" : "light";
}

export function storeMode(mode: ThemeMode): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(MODE_STORAGE_KEY, mode);
}
