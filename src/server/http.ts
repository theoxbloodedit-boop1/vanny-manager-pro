import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError } from "./errors";
import { AuthorizationError } from "./rbac/authorize";

/**
 * HTTP layer for the modular monolith (Module A).
 *
 * Route handlers stay one-liners: they translate (req) into a service call.
 * ALL error mapping lives here, so a service can throw domain errors
 * (ApiError, AuthorizationError, Better Auth APIError, ZodError) without
 * knowing anything about HTTP.
 */

export interface HttpErrorInfo {
  status: number;
  error: string;
  message: string;
}

/** Map any thrown value to a safe HTTP error envelope. */
export function toHttpError(e: unknown): HttpErrorInfo {
  if (e instanceof ApiError) {
    return { status: e.status, error: e.code, message: e.message };
  }
  if (e instanceof AuthorizationError) {
    return { status: e.status, error: e.reason, message: e.message };
  }
  if (e instanceof ZodError) {
    return { status: 400, error: "VALIDATION", message: "Invalid request data." };
  }

  // Better Auth / better-call errors: { statusCode, body: { code, message } }.
  if (e && typeof e === "object") {
    const obj = e as {
      name?: unknown;
      statusCode?: unknown;
      message?: unknown;
      body?: { code?: unknown; message?: unknown };
    };
    if (typeof obj.statusCode === "number" && obj.statusCode >= 400) {
      return {
        status: obj.statusCode,
        error:
          typeof obj.body?.code === "string" ? obj.body.code : "ERROR",
        message:
          typeof obj.body?.message === "string"
            ? obj.body.message
            : typeof obj.message === "string"
              ? obj.message
              : "Request failed.",
      };
    }
    if (obj.name === "BetterAuthError") {
      return {
        status: 400,
        error: "AUTH",
        message:
          typeof obj.message === "string"
            ? obj.message
            : "Authentication error.",
      };
    }
  }

  // Unknown → generic 500. Never leak internals to the client.
  return { status: 500, error: "INTERNAL", message: "Unexpected server error." };
}

/**
 * Wrap a request handler: JSON-in / JSON-out, uniform error envelope
 * `{ error, message }`, 5xx logged server-side only.
 */
export function handleApi(
  fn: (req: Request) => Promise<unknown>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      const result = await fn(req);
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      const err = toHttpError(e);
      if (err.status >= 500) console.error("[api] unhandled:", e);
      return NextResponse.json(
        { error: err.error, message: err.message },
        { status: err.status },
      );
    }
  };
}

/** Read an optional JSON body; malformed JSON → null (let the schema reject). */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
