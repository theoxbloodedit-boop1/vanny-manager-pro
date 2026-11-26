import { describe, expect, it } from "vitest";
import {
  BRANCH_SCOPED,
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  parseRoleList,
  roleHasPermission,
  type Role,
} from "../../src/server/rbac/permissions";

/**
 * Permission-matrix invariants — the SOLE source of truth (ADR-0001 Gate 1).
 * These are pure, deterministic: no DB, no auth instance.
 */
describe("permission matrix — structural invariants", () => {
  it("every granted permission is a known permission (no typos)", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const role of ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) {
        expect(known.has(p), `${role} grants unknown permission ${p}`).toBe(
          true,
        );
      }
    }
  });

  it("every role is present in ROLE_PERMISSIONS with an array", () => {
    for (const role of ROLES) {
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });

  it("owner holds every single business permission", () => {
    const owner = new Set(ROLE_PERMISSIONS.owner);
    for (const p of PERMISSIONS) expect(owner.has(p), p).toBe(true);
  });

  it("no role is empty and no permission is granted to nobody", () => {
    const granted = new Set<string>();
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
      for (const p of ROLE_PERMISSIONS[role]) granted.add(p);
    }
    for (const p of PERMISSIONS) {
      expect(granted.has(p), `no role holds ${p}`).toBe(true);
    }
  });

  it("BRANCH_SCOPED entries are all real permissions", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const p of BRANCH_SCOPED) expect(known.has(p), p).toBe(true);
  });

  it("a permission cannot be both org-level and branch-scoped ambiguously", () => {
    // sales.create / cash.* / inventory.adjust|transfer / expenses.create
    // are the ONLY branch-scoped actions; verify the set is exactly that.
    expect([...BRANCH_SCOPED].sort()).toEqual(
      [
        "sales.create",
        "cash.open",
        "cash.close",
        "cash.handover",
        "inventory.adjust",
        "inventory.transfer",
        "expenses.create",
      ].sort(),
    );
  });
});

describe("roleHasPermission — role resolution", () => {
  it("grants exactly what the matrix says (spot checks)", () => {
    expect(roleHasPermission("owner", "org.settings.manage")).toBe(true);
    expect(roleHasPermission("admin", "org.settings.manage")).toBe(false);
    expect(roleHasPermission("admin", "members.manage")).toBe(false);
    expect(roleHasPermission("cashier", "cash.open")).toBe(true);
    expect(roleHasPermission("cashier", "reports.view")).toBe(false);
    expect(roleHasPermission("seller", "sales.create")).toBe(true);
    expect(roleHasPermission("seller", "cash.open")).toBe(false);
    expect(roleHasPermission("accountant", "reports.export")).toBe(true);
    expect(roleHasPermission("stock_manager", "inventory.adjust")).toBe(true);
    expect(roleHasPermission("stock_manager", "sales.create")).toBe(false);
  });

  it("a multi-role string grants the UNION of its roles", () => {
    // manager can open cash but not export reports; accountant can export
    // reports but not open cash. Together they can do both.
    expect(roleHasPermission("manager, accountant", "cash.open")).toBe(true);
    expect(roleHasPermission("manager, accountant", "reports.export")).toBe(
      true,
    );
    expect(roleHasPermission("manager, accountant", "org.settings.manage")).toBe(
      false,
    );
  });

  it("trims whitespace and de-duplicates roles", () => {
    expect(parseRoleList(" cashier , cashier ")).toEqual(["cashier"]);
    expect(parseRoleList("owner,admin,owner")).toEqual(["owner", "admin"]);
  });

  it("ignores unknown role tokens and empties safely", () => {
    expect(parseRoleList("bogus, cashier")).toEqual(["cashier"]);
    expect(parseRoleList("")).toEqual([]);
    expect(parseRoleList(",,,")).toEqual([]);
    expect(roleHasPermission("", "sales.create")).toBe(false);
    expect(roleHasPermission("nonsense", "sales.create")).toBe(false);
  });

  it("an unknown role can never grant a real permission", () => {
    for (const p of PERMISSIONS) {
      expect(roleHasPermission("definitely-not-a-role", p)).toBe(false);
    }
  });

  it("admin is a strict subset of owner (nothing admin has that owner lacks)", () => {
    const owner = new Set(ROLE_PERMISSIONS.owner);
    for (const p of ROLE_PERMISSIONS.admin) expect(owner.has(p), p).toBe(true);
    // ...and admin is missing at least the org-settings power:
    expect(ROLE_PERMISSIONS.admin.includes("org.settings.manage")).toBe(false);
  });

  it("every role listed in ROLES is addressable by roleHasPermission", () => {
    for (const role of ROLES as readonly Role[]) {
      // The resolver must recognize the role token itself.
      expect(parseRoleList(role)).toEqual([role]);
    }
  });
});
