import { createAccessControl } from "better-auth/plugins";

/**
 * Organization-MANAGEMENT access control — enforced by the Better Auth
 * organization plugin (ADR-0002).
 *
 * Statement structure mirrors the plugin's own default statements
 * (resource / action), so plugin permission checks resolve exactly as
 * designed:
 *
 *   invitation.create  → create invitation      invitation.cancel → cancel it
 *   member.create      → add a member           member.update   → change role
 *   member.delete      → remove a member        organization.update / .delete
 *
 * Deliberately SEPARATE from the business matrix in `permissions.ts`:
 * a business-permission bug can never grant "delete the organization".
 */

export const orgAccessControl = createAccessControl({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
});

/** Read-only baseline: every role can read the access-control surface. */
const readOnly = {
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ["read"],
} as const;

export const orgRoles = {
  owner: orgAccessControl.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
  }),
  // Full management except destroying the organization itself.
  admin: orgAccessControl.newRole({
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
  }),
  // Operators: no org-management powers; org-level actions are still gated
  // by the BUSINESS matrix (permissions.ts) + branch access.
  manager: orgAccessControl.newRole(readOnly),
  stock_manager: orgAccessControl.newRole(readOnly),
  accountant: orgAccessControl.newRole(readOnly),
  cashier: orgAccessControl.newRole(readOnly),
  seller: orgAccessControl.newRole(readOnly),
};
