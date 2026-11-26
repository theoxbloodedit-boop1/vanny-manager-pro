import { and, eq, inArray } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { uuidv7 } from "../lib/uuid";
import { sendVerificationEmail } from "../server/email";
import { orgAccessControl, orgRoles } from "../server/rbac/org-roles";
import {
  accounts,
  invitations,
  members,
  sessions,
  users,
  verifications,
} from "../db/schema/auth";
import { branchAccess, branches, organizations } from "../db/schema/org";
import { getAuthDb } from "./db";

/**
 * Better Auth instance (ADR-0002, ADR-0012).
 *
 * - Identity: email + password, sessions.
 * - Tenancy: the organization plugin owns `organization`/`member`/
 *   `invitation`. The organization table is our `organizations` table —
 *   one tenant root, no duplicated identity.
 * - Organization ids are UUIDv7: the `beforeCreateOrganization` hook
 *   supplies the id (Better Auth's own generator emits cuids, which would
 *   violate the `uuid` column type). The adapter runs the insert with
 *   `forceAllowId: true`, so the supplied id is honored.
 * - Org-management permissions (invite / role change / delete) are enforced
 *   by the plugin via `orgAccessControl` + `orgRoles` — a layer separate
 *   from the business permission matrix (src/server/rbac/permissions.ts).
 */
export function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error(
      "Missing BETTER_AUTH_SECRET. Generate one: openssl rand -base64 48",
    );
  }
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret,
    database: drizzleAdapter(getAuthDb(), {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        organization: organizations,
        member: members,
        invitation: invitations,
      },
    }),
    // EMAIL VERIFICATION (ADR-0013). The org plugin hard-blocks listing and
    // accepting invitations unless the session's email is verified — a
    // security control we keep, not work around. The token is signed by
    // Better Auth and redeemed at /verify-email; only the delivery leg is
    // environment-dependent (see src/server/email.ts).
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: 24 * 60 * 60, // 24h
      sendVerificationEmail,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      // Labeled development transport (SECURITY.md §5): until Phase 4 wires
      // Resend, reset tokens are logged server-side. The flow itself (token
      // creation, validation, password change) is real and tested; only the
      // delivery leg is a placeholder. Invitation emails work the same way —
      // the invitation record and acceptance flow are fully functional.
      sendResetPassword: async ({ user, url }) => {
        if (process.env.NODE_ENV === "test") return;
        console.info(
          `[auth:dev-transport] Password reset for ${user.email}: ${url}`,
        );
      },
    },
    plugins: [
      organization({
        creatorRole: "owner",
        ac: orgAccessControl,
        roles: orgRoles,
        organizationLimit: 5,
        schema: {
          organization: {
            additionalFields: {
              businessSector: { type: "string", required: true },
              baseCurrency: { type: "string", required: true },
              timezone: { type: "string", required: false },
            },
          },
          invitation: {
            additionalFields: {
              branchIds: { type: "string", required: false },
            },
          },
        },
        organizationHooks: {
          beforeCreateOrganization: async () => ({
            data: { id: uuidv7() },
          }),
          // Materialize branch grants when an invitation is accepted. The
          // invitation carries `branchIds` (JSON array); they are applied
          // here, scoped to the org, so an unaccepted invitation grants
          // nothing.
          afterAcceptInvitation: async ({ invitation, member, user, organization }) => {
            const raw = (invitation as { branchIds?: string }).branchIds;
            if (!raw) return;
            let branchIds: string[];
            try {
              branchIds = JSON.parse(raw) as string[];
            } catch {
              return;
            }
            if (!Array.isArray(branchIds) || branchIds.length === 0) return;
            const orgId = organization.id;
            const db = getAuthDb();
            // Confirm each branch belongs to this org before granting.
            const valid = await db
              .select({ id: branches.id })
              .from(branches)
              .where(and(eq(branches.orgId, orgId), inArray(branches.id, branchIds)));
            if (valid.length === 0) return;
            const validIds = new Set(valid.map((b) => b.id));
            await db.insert(branchAccess).values(
              branchIds
                .filter((id) => validIds.has(id))
                .map((branchId) => ({
                  id: uuidv7(),
                  orgId,
                  branchId,
                  userId: member.userId,
                  grantedBy: user.id,
                })),
            );
          },
        },
      }),
    ],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** Singleton for the running server (route handlers, server components). */
export function getAuth() {
  instance ??= createAuth();
  return instance;
}

/** Tests create isolated instances; reset between runs. */
export function resetAuth(): void {
  instance = undefined;
}
