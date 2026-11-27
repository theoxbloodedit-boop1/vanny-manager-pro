/**
 * Business permission matrix (ADR-0001 binding rule 1, Gate 1).
 *
 * This is the SOLE source of truth for role → business permission.
 * `authorize()` is the only authorization entry point in feature code —
 * there is no `role === "owner"` comparison anywhere else.
 *
 * Org-MANAGEMENT permissions (invite, change role, delete org) live in
 * `org-roles.ts` and are enforced by the Better Auth organization plugin —
 * a deliberately separate layer, so a business-permission bug can never
 * grant org-admin powers.
 */

export const PERMISSIONS = [
  // catalog
  "products.view",
  "products.create",
  "products.update",
  "products.delete",
  "categories.manage",
  // inventory
  "inventory.view",
  "inventory.adjust",
  "inventory.transfer",
  // sales
  "sales.create",
  "sales.view",
  "sales.cancel",
  "sales.refund",
  // cash
  "cash.open",
  "cash.close",
  "cash.view",
  "cash.handover",
  // parties
  "customers.view",
  "customers.manage",
  "suppliers.view",
  "suppliers.manage",
  // money out
  "expenses.create",
  "expenses.view",
  // reporting
  "reports.view",
  "reports.export",
  // transfers & structure
  "transfers.manage",
  "branches.manage",
  // administration
  "org.settings.manage",
  "members.invite",
  "members.manage",
  "audit.view",
  // vault (coffre-fort, ADR-0022)
  "vault.view",
  "vault.deposit",
  "vault.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  "owner",
  "admin",
  "manager",
  "cashier",
  "seller",
  "stock_manager",
  "accountant",
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Permissions that additionally require a `branch_access` row when a branch
 * context is supplied to `authorize()`. Everything else is org-level.
 */
export const BRANCH_SCOPED: ReadonlySet<Permission> = new Set<Permission>([
  "sales.create",
  "cash.open",
  "cash.close",
  "cash.handover",
  "inventory.adjust",
  "inventory.transfer",
  "expenses.create",
]);

const ALL: readonly Permission[] = PERMISSIONS;

const ADMIN: readonly Permission[] = [
  // everything except org settings and role management
  "products.view",
  "products.create",
  "products.update",
  "products.delete",
  "categories.manage",
  "inventory.view",
  "inventory.adjust",
  "inventory.transfer",
  "sales.create",
  "sales.view",
  "sales.cancel",
  "sales.refund",
  "cash.open",
  "cash.close",
  "cash.view",
  "cash.handover",
  "customers.view",
  "customers.manage",
  "suppliers.view",
  "suppliers.manage",
  "expenses.create",
  "expenses.view",
  "reports.view",
  "reports.export",
  "transfers.manage",
  "branches.manage",
  "members.invite",
  "audit.view",
  "vault.view",
  "vault.deposit",
  "vault.manage",
];

const MANAGER: readonly Permission[] = [
  "products.view",
  "inventory.view",
  "inventory.adjust",
  "sales.create",
  "sales.view",
  "sales.cancel",
  "cash.open",
  "cash.close",
  "cash.view",
  "cash.handover",
  "customers.view",
  "customers.manage",
  "expenses.create",
  "expenses.view",
  "reports.view",
  "transfers.manage",
  "vault.view",
  "vault.deposit",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // The owner holds every business permission. Org management (delete org,
  // change roles) is theirs via the org layer (`org-roles.ts`).
  owner: ALL,
  admin: ADMIN,
  manager: MANAGER,
  cashier: ["cash.open", "cash.close", "cash.view", "sales.create", "sales.view", "customers.view", "customers.manage"],
  seller: ["sales.create", "sales.view", "customers.view", "customers.manage", "products.view"],
  stock_manager: [
    "inventory.view",
    "inventory.adjust",
    "inventory.transfer",
    "transfers.manage",
    "products.view",
    "suppliers.view",
  ],
  accountant: [
    "reports.view",
    "reports.export",
    "expenses.view",
    "sales.view",
    "cash.view",
    "customers.view",
    "audit.view",
    "vault.view",
  ],
};

function buildRoleSets(): Record<Role, ReadonlySet<Permission>> {
  const out = {} as Record<Role, ReadonlySet<Permission>>;
  for (const r of ROLES) out[r] = new Set(ROLE_PERMISSIONS[r]);
  return out;
}

const roleSets: Record<Role, ReadonlySet<Permission>> = buildRoleSets();

/**
 * Roles are stored comma-separated ("owner,admin") — see Better Auth's
 * `parseRoles`. Returns the distinct, trimmed role codes.
 */
export function parseRoleList(role: string): Role[] {
  const out = new Set<Role>();
  for (const raw of role.split(",")) {
    const r = raw.trim();
    if ((ROLES as readonly string[]).includes(r)) out.add(r as Role);
  }
  return [...out];
}

/** True if ANY of the (possibly multiple) roles grants the permission. */
export function roleHasPermission(role: string, permission: Permission): boolean {
  return parseRoleList(role).some((r) => roleSets[r].has(permission));
}
