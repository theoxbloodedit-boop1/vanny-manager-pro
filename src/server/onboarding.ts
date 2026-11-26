import { eq } from "drizzle-orm";
import * as z from "zod";
import { getAuth } from "../auth";
import { withTenantDb } from "../db/tenant";
import { branches, branchAccess, organizations } from "../db/schema/org";
import { uuidv7 } from "../lib/uuid";
import { ApiError } from "./errors";
import { isManuallyApproved } from "./manual-approval";

/**
 * Onboarding — turns a freshly-signed-up user into a working tenant
 * (Module A, ROADMAP 1.3).
 *
 * One transaction of intent, several layers:
 *   1. Better Auth creates the organization (+ the creator as `owner` member,
 *      via creatorRole). The org id is a UUIDv7 supplied by our hook.
 *   2. A tenant-scoped write creates the first branch and grants the creator
 *      branch access at it.
 *
 * The organization row is the SAME `organizations` table the rest of the
 * schema uses as its tenant root — no duplicated identity (ADR-0002/0012).
 */

export const sectorEnum = ["boutique", "bar", "restaurant", "salon", "pharmacy"] as const;
export const currencyEnum = ["USD", "CDF"] as const;

export const onboardingSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug: lowercase alphanumerics and dashes"),
  sector: z.enum(sectorEnum),
  baseCurrency: z.enum(currencyEnum),
  timezone: z.string().min(1).max(64).default("Africa/Kinshasa"),
  firstBranchName: z.string().min(1).max(120),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;

export interface OnboardingResult {
  orgId: string;
  branchId: string;
}

/** Derive a slug from a display name (caller may override). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function runOnboarding(
  headers: Headers,
  raw: unknown,
): Promise<OnboardingResult> {
  const input = onboardingSchema.parse(raw);

  const auth = getAuth();
  const session = await auth.api.getSession({ headers });
  if (!session?.user) {
    throw new ApiError(401, "UNAUTHORIZED", "Sign in required");
  }

  // ADR-0016 verification gate (SERVER-side — before this ADR it existed only
  // in the client, so a direct API call could bypass email verification and
  // create an org). A user may onboard when their email is VERIFIED or they
  // are MANUALLY APPROVED (audited operator action; for phone accounts the
  // approval is the trust anchor). Approval never implies emailVerified.
  if (!session.user.emailVerified) {
    const approved = await isManuallyApproved(session.user.id);
    if (!approved) {
      throw new ApiError(
        403,
        "VERIFICATION_REQUIRED",
        "Vérifiez votre email (ou faites valider votre compte) avant de créer une organisation.",
      );
    }
  }

  // A user who already has an organization is re-onboarding — refuse loudly.
  const existing = await auth.api.listOrganizations({ headers });
  if (existing.length > 0) {
    throw new ApiError(
      409,
      "ALREADY_ONBOARDED",
      "This account already belongs to an organization.",
    );
  }

  // 1) Organization + owner membership (Better Auth, creatorRole = owner).
  const org = await auth.api.createOrganization({
    body: {
      name: input.name,
      slug: input.slug,
      businessSector: input.sector,
      baseCurrency: input.baseCurrency,
      timezone: input.timezone,
    },
    headers,
  });

  const orgId = (org as { id: string }).id;

  // 2) First branch + creator branch access, tenant-scoped.
  const branchId = uuidv7();
  await withTenantDb(orgId, async (db) => {
    await db.insert(branches).values({
      id: branchId,
      orgId,
      name: input.firstBranchName,
    });
    await db.insert(branchAccess).values({
      id: uuidv7(),
      orgId,
      branchId,
      userId: session.user.id,
      grantedBy: session.user.id,
    });
  });

  // Sanity: the organization row carries the business sector we asked for.
  const check = await withTenantDb(orgId, async (db) =>
    db.select({ businessSector: organizations.businessSector }).from(organizations).where(eq(organizations.id, orgId)),
  );
  if (check[0]?.businessSector !== input.sector) {
    throw new ApiError(500, "ONBOARDING_INCOMPLETE", "Organization not fully provisioned");
  }

  return { orgId, branchId };
}
