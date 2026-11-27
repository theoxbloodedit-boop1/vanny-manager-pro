import { eq, inArray, or, sql, desc, type SQL } from "drizzle-orm";
import * as z from "zod";
import { getAuthDb } from "../auth/db";
import { getAuth } from "../auth";
import { withTenantDb } from "../db/tenant";
import { branches, branchAccess } from "../db/schema/org";
import { invitations, members, users } from "../db/schema/auth";
import { cashSessions } from "../db/schema/cash";
import { customers } from "../db/schema/sales";
import { uuidv7 } from "../lib/uuid";
import { ApiError } from "./errors";
import { isManuallyApproved } from "./manual-approval";
import { normalizePhone, PhoneError } from "./phone";
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

/** Session → { userId, active orgId } (401/404 fail-closed). Shared. */
export async function requireActiveOrg(headers: Headers): Promise<{
  userId: string;
  orgId: string;
}> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers });
  if (!session?.user) throw new ApiError(401, "UNAUTHORIZED", "Authentification requise");
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
 * Update a branch's details (name, address, phone, active flag).
 * Body: { id, name?, address?, phone?, isActive? }. At least one field.
 */
const updateBranchBody = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function updateBranch(headers: Headers, raw: unknown) {
  const body = updateBranchBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);

  const changed = await withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "branches.manage" });
    // The branch must belong to THIS org (RLS-scoped: foreign id → no row).
    const rows = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.id, body.id));
    if (rows.length === 0) {
      throw new ApiError(404, "NOT_FOUND", "Succursale introuvable.");
    }
    const fields: Record<string, unknown> = {};
    if (body.name !== undefined) fields.name = body.name;
    if (body.address !== undefined) fields.address = body.address;
    if (body.phone !== undefined) fields.phone = body.phone;
    if (body.isActive !== undefined) fields.isActive = body.isActive;
    const result = await db
      .update(branches)
      .set(fields)
      .where(eq(branches.id, body.id))
      .returning({ id: branches.id });
    return result[0]?.id ?? null;
  });

  if (!changed) {
    throw new ApiError(404, "NOT_FOUND", "Succursale introuvable.");
  }
  return { ok: true };
}

/**
 * Delete a branch (shop) permanently.
 *
 * Sales, cash registers and branch-access rows cascade automatically. Two
 * foreign keys do NOT cascade, so we clear them first to make the delete
 * atomic and never fail halfway: cash sessions are dropped (a closed shop has
 * no open sessions) and customers lose their branch link (kept, branchless).
 */
const deleteBranchBody = z.object({ id: z.string().uuid() });

export async function deleteBranch(headers: Headers, raw: unknown) {
  const body = deleteBranchBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);

  await withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "branches.manage" });
    const rows = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.id, body.id));
    if (rows.length === 0) {
      throw new ApiError(404, "NOT_FOUND", "Succursale introuvable.");
    }
    await db.delete(cashSessions).where(eq(cashSessions.branchId, body.id));
    await db
      .update(customers)
      .set({ branchId: null })
      .where(eq(customers.branchId, body.id));
    await db.delete(branches).where(eq(branches.id, body.id));
  });

  return { ok: true };
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
    throw new ApiError(400, "INVALID_BRANCH", "Succursale introuvable");
  }
  if (!checked.memberOk) {
    throw new ApiError(400, "NOT_A_MEMBER", "Cet utilisateur n’est pas membre de l’organisation");
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
  /**
   * ADR-0032: invitee's WhatsApp number (E.164). Lets a WhatsApp-only account
   * (no real mailbox) accept the invitation by phone match.
   */
  phone: z.string().max(32).optional(),
  branchIds: z.array(z.string().uuid()).max(50).optional(),
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
  // Normalize the invitee's WhatsApp number to E.164 so a phone account can
  // match this invitation later (ADR-0032). Invalid → clear French error.
  let invitePhone: string | undefined;
  if (body.phone) {
    try {
      invitePhone = normalizePhone(body.phone);
    } catch (e) {
      if (e instanceof PhoneError) {
        throw new ApiError(400, "INVALID_PHONE", `Numéro WhatsApp invalide : ${e.message}`);
      }
      throw e;
    }
  }
  const { userId, orgId } = await requireActiveOrg(headers);

  const wantedBranchIds = body.branchIds ? [...new Set(body.branchIds)] : [];

  // Branches must belong to this org (RLS-scoped: foreign ids yield no rows).
  // Skip the check entirely when no branches are requested (invite with no
  // branch access yet).
  if (wantedBranchIds.length > 0) {
    const valid = await withTenantDb(orgId, async (db) => {
      await authorize(db, { userId, permission: "members.invite" });
      const rows = await db
        .select({ id: branches.id })
        .from(branches)
        .where(inArray(branches.id, wantedBranchIds));
      return rows.length === wantedBranchIds.length;
    });
    if (!valid) {
      throw new ApiError(400, "INVALID_BRANCH", "Succursale inconnue pour cette organisation");
    }
  } else {
    await withTenantDb(orgId, (db) =>
      authorize(db, { userId, permission: "members.invite" }),
    );
  }

  const auth = getAuth();
  const invitation = await auth.api.createInvitation({
    body: {
      email: body.email,
      role: body.role,
      organizationId: orgId,
      branchIds: JSON.stringify(wantedBranchIds),
      ...(invitePhone ? { phone: invitePhone } : {}),
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
      throw new ApiError(404, "MEMBER_NOT_FOUND", "Membre introuvable");
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
    throw new ApiError(400, "LAST_OWNER", "Une organisation doit garder au moins un propriétaire");
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
  const result = (await getAuth().api.listMembers({
    query: { organizationId: orgId },
    headers,
  })) as {
    members: {
      id: string;
      role: string;
      user: { id: string; name: string; email: string };
    }[];
    total: number;
  };

  // ADR-0016: attach the WhatsApp number to phone accounts so the admin UI
  // shows the number instead of the virtual email. Platform `user` table.
  if (result.members.length > 0) {
    const db = getAuthDb();
    const rows = await db
      .select({ id: users.id, phone: users.phone })
      .from(users)
      .where(inArray(users.id, result.members.map((m) => m.user.id)));
    const phoneById = new Map(rows.map((r) => [r.id, r.phone]));
    for (const m of result.members) {
      (m.user as { phone?: string | null }).phone =
        phoneById.get(m.user.id) ?? null;
    }
  }
  return result;
}

/**
 * Read the signed-in user's WhatsApp number (E.164) from the platform user
 * row. The Better Auth session only carries name/email/emailVerified — the
 * phone number (ADR-0016) is a custom column read separately (as in me.ts).
 */
async function getUserPhone(userId: string): Promise<string | null> {
  const row = await getAuthDb()
    .select({ phone: users.phone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row[0]?.phone ?? null;
}

/** Pending invitations addressed to the signed-in user's email or phone. */
export async function myInvitations(headers: Headers) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers });
  if (!session?.user) throw new ApiError(401, "UNAUTHORIZED", "Authentification requise");

  // ADR-0020/0032: the invitation is the trust anchor. `listUserInvitations`
  // is email-gated, which blocks an unverified invitee from ever seeing (and
  // thus accepting) their invitation. Read the invitation rows directly by the
  // session email OR phone (a WhatsApp account has no real email — its
  // deterministic virtual email never matches an email-based invitation, so we
  // match on `user.phone`). The accept gate already permits this.
  const phone = await getUserPhone(session.user.id);

  if (session.user.email || phone) {
    const db = getAuthDb();
    const emailCond = session.user.email
      ? eq(invitations.email, session.user.email)
      : null;
    const phoneCond = phone
      ? eq(invitations.phone, phone)
      : null;
    return db
      .select({
        id: invitations.id,
        organizationId: invitations.organizationId,
        email: invitations.email,
        role: invitations.role,
        status: invitations.status,
        phone: invitations.phone,
      })
      .from(invitations)
      .where(
        or(
          ...([emailCond, phoneCond].filter((c): c is NonNullable<typeof c> => Boolean(c)) as SQL[]),
        ),
      )
      .orderBy(desc(invitations.createdAt));
  }
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
  if (!session?.user) throw new ApiError(401, "UNAUTHORIZED", "Authentification requise");
  // ADR-0014 verification gate, ADR-0020 revised. The plugin's own email
  // check on acceptance is disabled (requireEmailVerificationOnInvitation:
  // false), so we enforce it here. A user may accept if their email is
  // VERIFIED or they are MANUALLY APPROVED (audited operator action).
  //
  // ADR-0020: a user who holds a VALID PENDING invitation for this org is
  // ALSO allowed to accept, because the invitation itself is the trust anchor
  // — the owner vouched for this specific person by emailing them the
  // invitation. This is what makes invitations work end-to-end WITHOUT a
  // working mailbox (no Resend): the invitee signs up with the invited email
  // (pre-filled by the shared link) and accepts immediately. The plugin STILL
  // enforces the invitation token (valid/expiring/single-use), the
  // recipient-email match (cross-tenant acceptance is impossible by
  // construction), and permission control — the link's security is
  // unchanged. Approval never implies emailVerified.
  if (!session.user.emailVerified) {
    const approved = await isManuallyApproved(session.user.id);
    if (approved) {
      // fall through to accept
    } else {
      // ADR-0020: check whether THIS user holds the VALID PENDING invitation
      // they are accepting — by a direct platform lookup on the invitation
      // row (NOT via listUserInvitations, which is itself email-gated and
      // would fail for an unverified user). The invitation is the trust
      // anchor: the owner vouched for this specific recipient by emailing the
      // invitation. We verify the recipient email matches the session user
      // and the invitation is pending + unexpired. Fail-closed otherwise.
      const db = getAuthDb();
      const invRows = await db
        .select({
          email: invitations.email,
          phone: invitations.phone,
          status: invitations.status,
          expiresAt: invitations.expiresAt,
        })
        .from(invitations)
        .where(eq(invitations.id, body.invitationId))
        .limit(1);
      const inv = invRows[0];
      const phone = await getUserPhone(session.user.id);
      // ADR-0032: the recipient may match by email OR by WhatsApp number (a
      // WhatsApp account's virtual email never equals the invitation email).
      const held =
        inv !== undefined &&
        inv.status === "pending" &&
        ((!!session.user.email &&
          inv.email.toLowerCase() === session.user.email.toLowerCase()) ||
          (!!phone && !!inv.phone && inv.phone === phone)) &&
        (inv.expiresAt.getTime() > Date.now());
      if (!held) {
        throw new ApiError(
          403,
          "VERIFICATION_REQUIRED",
          "This account must be verified or manually approved before accepting an invitation.",
        );
      }
    }
  }
  return auth.api.acceptInvitation({ body: { invitationId: body.invitationId }, headers });
}
