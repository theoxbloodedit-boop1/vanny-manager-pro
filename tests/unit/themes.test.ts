import { describe, expect, it } from "vitest";
import {
  clearTheme,
  isThemeId,
  resolveTheme,
  THEMES,
  THEME_IDS,
  TOKEN_CSS_VARS,
  tokenSetToCssVars,
} from "@/themes/themes";

describe("catalog integrity", () => {
  it("has exactly 12 tones, each with light + dark sets", () => {
    expect(THEME_IDS).toHaveLength(12);
    for (const id of THEME_IDS) {
      const def = THEMES[id];
      expect(def, `missing theme ${id}`).toBeTruthy();
      expect(def.label).toBeTruthy();
      for (const mode of ["light", "dark"] as const) {
        const set = def[mode];
        for (const key of Object.keys(TOKEN_CSS_VARS) as (keyof typeof TOKEN_CSS_VARS)[]) {
          expect(typeof set[key], `${id}/${mode}/${key}`).toBe("string");
          expect((set[key] as string).length, `${id}/${mode}/${key} empty`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("every token set maps to a distinct CSS variable", () => {
    const vars = Object.values(TOKEN_CSS_VARS);
    expect(new Set(vars).size).toBe(vars.length);
    for (const v of vars) expect(v.startsWith("--color-")).toBe(true);
  });
});

describe("isThemeId", () => {
  it("accepts catalog ids", () => {
    for (const id of THEME_IDS) expect(isThemeId(id)).toBe(true);
  });
  it("rejects unknown values and non-strings", () => {
    expect(isThemeId("neon-pink")).toBe(false);
    expect(isThemeId("")).toBe(false);
    expect(isThemeId(null)).toBe(false);
    expect(isThemeId(42)).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
  });
});

describe("resolveTheme (fail-closed)", () => {
  it("null / undefined → null (neutral render)", () => {
    expect(resolveTheme(null, "light")).toBeNull();
    expect(resolveTheme(undefined, "dark")).toBeNull();
    expect(resolveTheme("", "light")).toBeNull();
  });
  it("unknown id → null, never throws", () => {
    expect(resolveTheme("neon-pink", "light")).toBeNull();
    expect(resolveTheme("EMBER-NOIR", "dark")).toBeNull(); // case-sensitive
  });
  it("known id → the requested mode's set", () => {
    const light = resolveTheme("ember-noir", "light");
    const dark = resolveTheme("ember-noir", "dark");
    expect(light).toBe(THEMES["ember-noir"].light);
    expect(dark).toBe(THEMES["ember-noir"].dark);
    expect(light!.bg).not.toBe(dark!.bg);
  });
});

describe("tokenSetToCssVars", () => {
  it("produces one entry per token, keyed by CSS variable", () => {
    const vars = tokenSetToCssVars(THEMES.crimson.light);
    expect(Object.keys(vars)).toHaveLength(Object.keys(TOKEN_CSS_VARS).length);
    expect(vars["--color-background"]).toBe(THEMES.crimson.light.bg);
    expect(vars["--color-primary"]).toBe(THEMES.crimson.light.accent);
    expect(vars["--color-accent"]).toBe(THEMES.crimson.light.danger);
  });
});

describe("clearTheme (no-SSR guard)", () => {
  it("does not throw when document is absent", () => {
    expect(() => clearTheme()).not.toThrow();
  });
});
