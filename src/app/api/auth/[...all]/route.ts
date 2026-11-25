import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/auth";

/**
 * Better Auth HTTP surface (sign-up, sign-in, sessions, /verify-email,
 * organization endpoints…). The instance is created lazily so a missing
 * BETTER_AUTH_SECRET surfaces at request time, not at import time.
 */
const handler = toNextJsHandler((request) => getAuth().handler(request));

export const GET = handler.GET;
export const POST = handler.POST;
export const PATCH = handler.PATCH;
export const PUT = handler.PUT;
export const DELETE = handler.DELETE;
