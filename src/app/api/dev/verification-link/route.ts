import { handleApi } from "@/server/http";
import { devVerificationLink } from "@/server/me";

/**
 * GET /api/dev/verification-link — DEVELOPMENT ONLY.
 *
 * Returns the signed email-verification URL for the signed-in user so a
 * sandbox without SMTP can complete the (real) verification flow. This route
 * 404s in production and when a real mail transport is configured — see
 * src/server/me.ts.
 */
export const GET = handleApi(async (req) => devVerificationLink(req.headers));
