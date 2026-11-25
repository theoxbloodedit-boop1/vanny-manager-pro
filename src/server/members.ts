import { eq, inArray, sql } from "drizzle-orm";
import * as z from "zod";
import { getAuth } from "../auth";
import { withTenantDb } from "../db/tenant";
import { branches, branchAccess } from "../db/schema/org";
import { members } from "../db/schema/auth";
import { uuidv7 } from "../lib/uuid";
import { ApiError } from "./errors";
import { authorize } from "./rbac/authorize";
import { ROLES, type Role } from "./rbac/permissions";

/**
 * Services over branches, members and invitations (ROADMAP 1.4/1.5).
 *
 * Every function: validate input → resolve the caller's active org → enforce
 * the business permission with `authorize()` (RLS-scoped) → perform the
 * operation. The org-level management permission is then re-checked by the
 * Better Auth plugin itself on the calls that need it (defense in depth).
 */

async function requireActiveOrg(headers: Headers): Promise<{
  userId: string;
  orgId: string;
}> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers });
  if (!session?.user) throw new ApiError(401, "UNAUTHORIZED", "Sign in required");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) {
    throw new ApiError(
      404,
      "NO_ORGANIZATION",
      "No active organization. Complete onboarding first.",
    );
  }
  return { userId: session.user.id, orgId };
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

const branchBody = z.object({
  name: z.string().min(1).max(120),
  address: z.string().max(500).optional(),
  phone: z.string().max(32).optional(),
});

export async function listBranches(headers: Headers) {
  const { orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, (db) => db.select().from(branches));
}

export async function createBranch(headers: Headers, raw: unknown) {
  const body = branchBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  const id = uuidv7();
  await withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "branches.manage" });
    await db
      .insert(branches)
      .values({ id, orgId, name: body.name, address: body.address, phone: body.phone });
  });
  return { branchId: id };
}

/**
 * Grant a USER (already a member) access to a BRANCH. The org-level role
 * lives in `member`; this table only answers "may this person work here?".
 */
const grantBody = z.object({
  branchId: z.string().uuid(),
  userId: z.string().min(1),
});

export async function grantBranchAccess(headers: Headers, raw: unknown) {
  const body = grantBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);

  // The branch and the target user must both belong to THIS organization
  // (RLS-scoped: foreign ids simply yield no rows → 400, no leak).
  const checked = await withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "branches.manage" });
    const branchRows = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.id, body.branchId));
    const memberRows = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.userId, body.userId));
    return { branchOk: branchRows.length > 0, memberOk: memberRows.length > 0 };
  });
  if (!checked.branchOk) {
    throw new ApiError(400, "INVALID_BRANCH", "Branch not found");
  }
  if (!checked.memberOk) {
    throw new ApiError(400, "NOT_A_MEMBER", "User is not a member of this organization");
  }

  await withTenantDb(orgId, (db) =>
    db
      .insert(branchAccess)
      .values({
        id: uuidv7(),
        orgId,
        branchId: body.branchId,
        userId: body.userId,
        grantedBy: userId,
      })
      .onConflictDoNothing(),
  );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Invitations (Better Auth owns the record; we attach branch grants)
// ---------------------------------------------------------------------------

const inviteableRoles = ROLES.filter((r) => r !== "owner") as [Role, ...Role[]];

const inviteBody = z.object({
  email: z.string().email().max(200),
  role: z.enum(inviteableRoles),
  branchIds: z.array(z.string().uuid()).min(1).max(50),
});

/**
 * Invite a person by email with a role and branch assignments.
 *
 * Branch grants travel on the invitation (`branch_ids` additional field) and
 * are materialized into `branch_access` by the `afterAcceptInvitation` hook
 * when the member is actually added — an unaccepted invitation grants nothing.
 */
export async function inviteMember(headers: Headers, raw: unknown) {
  const body = inviteBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);

  // Branches must belong to this org (RLS-scoped: foreign ids yield no rows).
  const valid = await withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "members.invite" });
    const wanted = [...new Set(body.branchIds)];
    const rows = await db
      .select({ id: branches.id })
      .from(branches)
      .where(inArray(branches.id, wanted));
    return rows.length === wanted.length;
  });
  if (!valid) {
    throw new ApiError(400, "INVALID_BRANCH", "Unknown branch for this organization");
  }

  const auth = getAuth();
  const invitation = await auth.api.createInvitation({
    body: {
      email: body.email,
      role: body.role,
      organizationId: orgId,
      branchIds: JSON.stringify([...new Set(body.branchIds)]),
    },
    headers,
  });
  return { invitationId: (invitation as { id: string }).id };
}

const cancelInviteBody = z.object({ invitationId: z.string().min(1) });

export async function cancelInvitation(headers: Headers, raw: unknown) {
  const body = cancelInviteBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  await withTenantDb(orgId, (db) =>
    authorize(db, { userId, permission: "members.invite" }),
  );
  // organizationId is resolved from the session's active organization.
  await getAuth().api.cancelInvitation({
    body: { invitationId: body.invitationId },
    headers,
  });
  return { ok: true };
}

const roleBody = z.object({
  memberId: z.string().min(1),
  role: z.enum(inviteableRoles),
});

/**
 * Change a member's role. Roles are read from the database on every
 * authorize() call, so the change applies on the next request — no re-login
 * required (Gate 1).
 */
export async function changeMemberRole(headers: Headers, raw: unknown) {
  const body = roleBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  const auth = getAuth();

  // Last-owner guard: an organization must never be left without an owner.
  const target = await withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "members.manage" });
    const rows = await db
      .select({ id: members.id, role: members.role })
      .from(members)
      .where(eq(members.id, body.memberId));
    if (rows.length === 0) {
      throw new ApiError(404, "MEMBER_NOT_FOUND", "Member not found");
    }
    const owners = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(members)
      .where(sql`${members.role} LIKE '%owner%'`);
    return { role: rows[0]!.role, ownerCount: owners[0]!.count };
  });
  if (
    target.role.includes("owner") &&
    !body.role.includes("owner") &&
    target.ownerCount <= 1
  ) {
    throw new ApiError(400, "LAST_OWNER", "An organization must keep at least one owner");
  }

  await auth.api.updateMemberRole({
    body: { memberId: body.memberId, role: body.role, organizationId: orgId },
    headers,
  });
  return { ok: true };
}

export async function listMembers(headers: Headers) {
  const { orgId } = await requireActiveOrg(headers);
  // The plugin enforces membership on the org; business reads are RLS-scoped.
  return getAuth().api.listMembers({ query: { organizationId: orgId }, headers });
}

/** Pending invitations addressed to the signed-in user's email. */
export async function myInvitations(headers: Headers) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers });
  if (!session?.user) throw new ApiError(401, "UNAUTHORIZED", "Sign in required");
  return auth.api.listUserInvitations({ headers });
}

/**
 * Pending invitations OF the active organization (management view).
 * The plugin only lets members who may manage invitations see this list.
 */
export async function listOrgInvitations(headers: Headers) {
  const { orgId } = await requireActiveOrg(headers);
  return getAuth().api.listInvitations({
    query: { organizationId: orgId },
    headers,
  });
}

export async function acceptInvitation(headers: Headers, raw: unknown) {
  const body = z.object({ invitationId: z.string().min(1) }).parse(raw);
  const auth = getAuth();
  const session = await auth.api.getSession({ headers });
  if (!session?.user) throw new ApiError(401, "UNAUTHORIZED", "Sign in required");
  // Better Auth verifies the invitation is pending, unexpired, and that the
  // recipient's email matches this session — cross-tenant acceptance is
  // impossible by construction.
  return auth.api.acceptInvitation({ body: { invitationId: body.invitationId }, headers });
}
