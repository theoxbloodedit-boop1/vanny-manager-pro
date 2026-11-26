import { handleApi, readJson } from "@/server/http";
import { listPhoneApprovals, operatorApplyApproval } from "@/server/phone-auth";

/**
 * ADR-0016 (+ ADR-0017) — operator dashboard endpoints (platform,
 * operator-only).
 *
 * GET  → pending phone sign-ups + pending email accounts (invited users,
 *        ADR-0017) + recent approvals (each with its audit row).
 * POST → { phone | email, action: "approve"|"revoke", reason } → the
 *        ADR-0014 audited flow (atomic flag + append-only audit). Identity =
 *        the authenticated session, which must be an authorized platform
 *        operator.
 */
export const GET = handleApi(async (req) =>
  listPhoneApprovals(req.headers),
);

export const POST = handleApi(async (req) =>
  operatorApplyApproval(req.headers, await readJson(req)),
);
