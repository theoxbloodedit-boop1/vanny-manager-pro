import { eq } from "drizzle-orm";
import { getAuthDb } from "../auth/db";
import { getAuth } from "../auth";
import { withTenantDb } from "../db/tenant";
import { members, users } from "../db/schema/auth";
import { organizations } from "../db/schema/org";
import { ApiError } from "./errors";
import { takeCapturedMails } from "./email";
import { isVirtualEmail } from "./phone";
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
    /** ADR-0016: E.164 phone number for phone accounts, null otherwise. */
    phone: string | null;
    /** ADR-0014/0016: operator-approved (distinct from emailVerified). */
    manuallyApproved: boolean;
  };
  organization?: {
    id: string;
    name: string;
    slug: string;
    businessSector: string;
    baseCurrency: string;
    timezone: string | null;
    /** ADR-0015: tenant tone (static catalog id) or null = neutral. */
    themeId: string | null;
    /** ADR-0020: tenant branding — display name, logo, accent override. */
    brandName: string | null;
    logoUrl: string | null;
    brandColor: string | null;
  } | null;
  role?: string | null;
}

export async function getMe(headers: Headers): Promise<Me> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return { authenticated: false };

  // ADR-0016: phone + manual-approval live on the platform user row (the
  // session only carries name/email/emailVerified). One small read.
  const flagRows = await getAuthDb()
    .select({ phone: users.phone, manuallyApproved: users.manuallyApproved })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const me: Me = {
    authenticated: true,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      phone: flagRows[0]?.phone ?? null,
      manuallyApproved: flagRows[0]?.manuallyApproved ?? false,
    },
    organization: null,
    role: null,
  };

  // ADR-0021 (reconnect): une nouvelle session n'a pas d'organisation active.
  // Si l'utilisateur est déjà membre d'une organisation, on retrouve sa
  // membership et on restaure l'org active dans la session — sinon il retombe
  // sur l'onboarding et peut recréer une activité en double. Owner en priorité.
  let orgId = session.session.activeOrganizationId;
  if (!orgId) {
    const membershipRows = await getAuthDb()
      .select({ organizationId: members.organizationId, role: members.role })
      .from(members)
      .where(eq(members.userId, session.user.id));
    if (membershipRows.length > 0) {
      const ownerFirst = [...membershipRows].sort((a, b) => {
        const aOwner = a.role.includes("owner") ? 0 : 1;
        const bOwner = b.role.includes("owner") ? 0 : 1;
        return aOwner - bOwner;
      });
      orgId = ownerFirst[0]?.organizationId;
      try {
        await auth.api.setActiveOrganization({
          headers,
          body: { organizationId: orgId },
        });
      } catch {
        // Si la restauration échoue (session non persistable, etc.), on
        // expose quand même l'org pour ce rendu — le routage post-auth
        // l'envoie sur son tableau de bord.
      }
    }
  }
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
    // ADR-0015/0020: the tone + branding live on the RLS-scoped org row (the
    // plugin's response is not typed for them) — one extra tiny read, same
    // scoping.
    const themeRows = await withTenantDb(orgId, (db) =>
      db
        .select({
          themeId: organizations.themeId,
          brandName: organizations.brandName,
          logoUrl: organizations.logoUrl,
          brandColor: organizations.brandColor,
        })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1),
    );
    if (org) {
      me.organization = {
        id: org.id,
        name: org.name,
        slug: org.slug,
        businessSector: org.businessSector ?? "",
        baseCurrency: org.baseCurrency ?? "",
        timezone: org.timezone ?? null,
        themeId: themeRows[0]?.themeId ?? null,
        brandName: themeRows[0]?.brandName ?? null,
        logoUrl: themeRows[0]?.logoUrl ?? null,
        brandColor: themeRows[0]?.brandColor ?? null,
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
  if (isVirtualEmail(session.user.email)) {
    // ADR-0016: phone accounts have no mailbox — no verification link can
    // ever be delivered. They are validated by the operator, not by mail.
    throw new ApiError(
      409,
      "PHONE_ACCOUNT",
      "Les comptes WhatsApp sont validés par l'équipe, pas par email.",
    );
  }
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
