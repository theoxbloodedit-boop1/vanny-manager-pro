/**
 * Minimal browser-side auth client (Module A).
 *
 * Talks to the Better Auth HTTP surface (/api/auth/*). The session cookie is
 * httpOnly + SameSite=Lax: the browser sends it automatically, JavaScript
 * never reads it. Pages that need the session call GET /api/me, which is the
 * single place identity + active org + role are resolved server-side.
 */

export interface AuthResult {
  ok: boolean;
  error?: string;
}

async function call(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`/api/auth${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON response
  }
  return { status: res.status, json };
}

export async function signUpEmail(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthResult> {
  const { status, json } = await call("/sign-up/email", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (status >= 400) {
    return { ok: false, error: String(json.message ?? "Inscription impossible") };
  }
  return { ok: true };
}

export async function signInEmail(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  const { status, json } = await call("/sign-in/email", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (status >= 400) {
    return { ok: false, error: String(json.message ?? "Connexion impossible") };
  }
  return { ok: true };
}

export async function signOut(): Promise<void> {
  await call("/sign-out", { method: "POST", body: "{}" });
}
