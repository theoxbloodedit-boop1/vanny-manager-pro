import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/auth";
import { isVirtualEmail } from "@/server/phone";

/**
 * Better Auth HTTP surface (sign-up, sign-in, sessions, /verify-email,
 * organization endpoints…). The instance is created lazily so a missing
 * BETTER_AUTH_SECRET surfaces at request time, not at import time.
 */
const handler = toNextJsHandler((request) => getAuth().handler(request));

/**
 * ADR-0016 domain guard. Phone accounts own the reserved virtual-email
 * domain (`@phone.vanny.app`) through the dedicated `/sign-up/phone` route.
 * The stock email sign-up must never create (or touch) a virtual address,
 * otherwise a phone account's identifier could be squatted. One check at the
 * edge of the Better Auth surface — every other path (email sign-in,
 * verification, reset) keeps working unchanged.
 */
async function guardPhoneVirtualDomain(
  request: Request,
  fallback: () => Promise<Response>,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname.endsWith("/sign-up/email")) {
    try {
      const body = (await request.clone().json()) as { email?: unknown };
      if (typeof body.email === "string" && isVirtualEmail(body.email)) {
        return Response.json(
          {
            error: "PHONE_DOMAIN_RESERVED",
            message:
              "Cette adresse est réservée aux inscriptions WhatsApp. Utilisez le champ « WhatsApp ».",
          },
          { status: 400 },
        );
      }
    } catch {
      // Malformed body — let Better Auth return its own validation error.
    }
  }
  return fallback();
}

export const GET = handler.GET;
export const POST = (request: Request) =>
  guardPhoneVirtualDomain(
    request,
    () => (handler.POST as (r: Request) => Promise<Response>)(request),
  );
export const PATCH = handler.PATCH;
export const PUT = handler.PUT;
export const DELETE = handler.DELETE;
