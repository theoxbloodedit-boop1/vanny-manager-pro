import { handleAuthApi, readJson } from "@/server/http";
import { signInByPhone } from "@/server/phone-auth";

/**
 * POST /api/auth/sign-in/phone — ADR-0016: sign in with a WhatsApp number.
 * Body: { phone, password }. The phone number maps deterministically to the
 * account's virtual email; the credential check is the standard one.
 */
export const POST = handleAuthApi(async (req) => signInByPhone(await readJson(req)));
