/**
 * Better Auth base URL resolution (ADR-0012 follow-up — "Invalid origin").
 *
 * Vercel gives every deployment its OWN url (`VERCEL_URL` at runtime). A
 * static `BETTER_AUTH_URL` therefore goes stale on every redeploy (new url)
 * and the origin check rejects browser requests with "Invalid origin" —
 * including a redeploy triggered by editing the variable itself.
 *
 * Precedence:
 *   1. `VERCEL_URL` (Vercel runtime, any deployment) — always matches the
 *      origin actually serving the app: origin check + absolute links
 *      (verification emails) are correct by construction.
 *   2. `BETTER_AUTH_URL` (self-hosted / non-Vercel deployments).
 *   3. Local development default.
 */
export function resolveBaseURL(
  env: Record<string, string | undefined> = process.env,
): string {
  const vercelUrl = (env.VERCEL_URL ?? "").trim();
  if (vercelUrl.length > 0) {
    return `https://${vercelUrl}`;
  }
  const configured = (env.BETTER_AUTH_URL ?? "").trim();
  if (configured.length > 0) {
    return configured;
  }
  return "http://localhost:3000";
}

/**
 * Trusted origins for Better Auth's origin/CSRF check (ADR-0012 follow-up,
 * 2026-11-26).
 *
 * `VERCEL_URL` is the DEPLOYMENT's own subdomain — but a production project
 * also serves its stable ALIAS domain (e.g. `vanny-manager-pro.vercel.app`),
 * which is a DIFFERENT origin. Trusting only the deployment URL makes browser
 * sign-in from the production domain fail with "Invalid origin" (hit in prod,
 * 2026-11-26). So we trust:
 *   1. the deployment's own URL (`VERCEL_URL`) — every deployment works standalone;
 *   2. `BETTER_AUTH_URL` (self-hosted / non-Vercel);
 *   3. `APP_PRODUCTION_URL` (the stable production alias domain).
 *
 * Returns [] when nothing is configured — callers must then keep Better Auth's
 * default (baseURL's origin) instead of an empty list, or local development
 * would trust nothing.
 */
export function resolveTrustedOrigins(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const origins = new Set<string>();
  const vercelUrl = (env.VERCEL_URL ?? "").trim();
  if (vercelUrl.length > 0) origins.add(`https://${vercelUrl}`);
  for (const key of ["BETTER_AUTH_URL", "APP_PRODUCTION_URL"] as const) {
    const value = (env[key] ?? "").trim().replace(/\/+$/, "");
    if (value.length > 0) origins.add(value);
  }
  return [...origins];
}
