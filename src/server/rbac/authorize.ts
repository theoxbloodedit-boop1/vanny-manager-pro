import { eq, and } from "drizzle-orm";
import type { TenantDb } from "../../db/tenant";
import { members } from "../../db/schema/auth";
import { branchAccess } from "../../db/schema/org";
import {
  BRANCH_SCOPED,
  parseRoleList,
  roleHasPermission,
  type Permission,
  type Role,
} from "./permissions";

/**
 * `authorize()` — the SINGLE authorization entry point (ADR-0001 rule 1).
 *
 * Call it inside `withTenantDb(orgId, async (db) => { await authorize(db, {...}); ... })`.
 * The db is already scoped to the org by RLS, so membership and branch
 * lookups can only ever see THIS tenant's rows.
 *
 * Returns the caller's role on success, or throws an `AuthorizationError`
 * with a machine-readable `reason` so the API layer can map it to 403 (or
 * 404 for "not a member", which we deliberately do NOT distinguish from a
 * 403 to avoid org-existence oracle leaks).
 */
export class AuthorizationError extends Error {
  readonly reason: "NOT_A_MEMBER" | "FORBIDDEN" | "NO_BRANCH_ACCESS";
  readonly status = 403;
  constructor(reason: AuthorizationError["reason"], message: string) {
    super(message);
    this.name = "AuthorizationError";
    this.reason = reason;
  }
}

export interface AuthzContext {
  userId: string;
  permission: Permission;
  /** Required when `permission` is in BRANCH_SCOPED. */
  branchId?: string;
}

/**
 * Resolve the caller's role within the current (RLS-scoped) org.
 * Returns null when the user is not a member of this org.
 */
export async function resolveRole(
  db: TenantDb,
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({ role: members.role })
    .from(members)
    .where(eq(members.userId, userId))
    .limit(1);
  return rows[0]?.role ?? null;
}

export async function authorize(
  db: TenantDb,
  ctx: AuthzContext,
): Promise<Role> {
  const roleStr = await resolveRole(db, ctx.userId);
  if (roleStr === null) {
    throw new AuthorizationError(
      "NOT_A_MEMBER",
      "You are not a member of this organization.",
    );
  }

  if (!roleHasPermission(roleStr, ctx.permission)) {
    throw new AuthorizationError(
      "FORBIDDEN",
      `Role lacks permission: ${ctx.permission}`,
    );
  }

  if (BRANCH_SCOPED.has(ctx.permission)) {
    if (!ctx.branchId) {
      // A branch-scoped permission must always be checked against a branch.
      // Failing closed here prevents a future caller from silently dropping
      // the branchId and widening access.
      throw new AuthorizationError(
        "NO_BRANCH_ACCESS",
        `Permission ${ctx.permission} requires a branchId.`,
      );
    }
    const grants = await db
      .select({ id: branchAccess.id })
      .from(branchAccess)
      .where(and(eq(branchAccess.userId, ctx.userId), eq(branchAccess.branchId, ctx.branchId)))
      .limit(1);
    if (grants.length === 0) {
      throw new AuthorizationError(
        "NO_BRANCH_ACCESS",
        "You are not assigned to this branch.",
      );
    }
  }

  return parseRoleList(roleStr)[0] as Role;
}
