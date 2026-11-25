import { eq } from "drizzle-orm";
import { getAuth } from "../auth";
import { withTenantDb } from "../db/tenant";
import { members } from "../db/schema/auth";
import { ApiError } from "./errors";
import { takeCapturedMails } from "./email";
import { parseRoleList } from "./rbac/permissions";

/**
 * Current-user profile (ROADMAP 1.6) — everything the shell UI needs:
 * identity, active organization, role, verification state.
 *
 * No browser-supplied organization id is ever trusted: the org comes from
 * the SESSION (server-side), then RLS scopes the membership lookup.
 */
export interface Me {
  authenticated: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
  };
  organization?: {
    id: string;
    name: string;
    slug: string;
    businessSector: string;
    baseCurrency: string;
    timezone: string | null;
  } | null;
  role?: string | null;
}

export async function getMe(headers: Headers): Promise<Me> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return { authenticated: false };

  const me: Me = {
    authenticated: true,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
    },
    organization: null,
    role: null,
  };

  const orgId = session.session.activeOrganizationId;
  if (!orgId) return me;

  // Organization metadata — the plugin enforces membership.
  try {
    const org = (await auth.api.getOrganization({
      query: { organizationId: orgId },
      headers,
    })) as
      | {
          id: string;
          name: string;
          slug: string;
          businessSector?: string;
          baseCurrency?: string;
          timezone?: string | null;
        }
      | null;
    if (org) {
      me.organization = {
        id: org.id,
        name: org.name,
        slug: org.slug,
        businessSector: org.businessSector ?? "",
        baseCurrency: org.baseCurrency ?? "",
        timezone: org.timezone ?? null,
      };
    }
  } catch {
    // Active org no longer readable (left/deleted) → treat as "no org";
    // the UI will route back to onboarding.
  }

  // Role — read from the RLS-scoped member table on every request.
  const rows = await withTenantDb(orgId, (db) =>
    db
      .select({ role: members.role })
      .from(members)
      .where(eq(members.userId, session.user.id))
      .limit(1),
  );
  me.role = rows[0] ? (parseRoleList(rows[0].role)[0] ?? null) : null;
  return me;
}

/**
 * DEVELOPMENT-ONLY helper: returns the verification URL for the signed-in
 * user's email.
 *
 * Available ONLY outside production (it is a hard 404 in production, where a
 * real provider or manual approval must be used). It never weakens the flow —
 * the URL is the same signed token a real mailbox would deliver; this merely
 * skips the mailbox leg, which a sandbox has no provider for. Non-production
 * records every outbound mail in the outbox (see src/server/email.ts), which
 * is how this endpoint reads the signed URL.
 */
export async function devVerificationLink(headers: Headers): Promise<{
  url: string;
}> {
  if (process.env.NODE_ENV === "production") {
    throw new ApiError(404, "NOT_FOUND", "Not found");
  }
  const auth = getAuth();
  const session = await auth.api.getSession({ headers });
  if (!session?.user) throw new ApiError(401, "UNAUTHORIZED", "Sign in required");
  if (session.user.emailVerified) {
    throw new ApiError(409, "ALREADY_VERIFIED", "Email already verified");
  }

  // Trigger a (re)send through the normal pipeline; non-production records
  // the signed URL in the in-memory outbox (see src/server/email.ts).
  await auth.api.sendVerificationEmail({
    body: { email: session.user.email },
    headers,
  });
  const mails = takeCapturedMails().filter(
    (m) => m.to.toLowerCase() === session.user.email.toLowerCase(),
  );
  const last = mails[mails.length - 1];
  if (!last) {
    throw new ApiError(500, "CAPTURE_FAILED", "Could not capture the mail");
  }
  return { url: last.url };
}
