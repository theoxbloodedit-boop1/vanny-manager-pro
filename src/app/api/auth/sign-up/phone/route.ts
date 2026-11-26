import { handleAuthApi, readJson } from "@/server/http";
import { signUpByPhone } from "@/server/phone-auth";

/**
 * POST /api/auth/sign-up/phone — ADR-0016: create a WhatsApp (phone) account.
 * Body: { name, phone, password }. Responds with the session Set-Cookie(s)
 * exactly like the stock email sign-up; the account stays INERT until an
 * operator approves it (see /api/operator/approvals).
 */
export const POST = handleAuthApi(async (req) => signUpByPhone(await readJson(req)));
