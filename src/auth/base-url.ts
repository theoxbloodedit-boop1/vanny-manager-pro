/**
 * Better Auth base URL resolution (ADR-0016 hotfix — "Invalid origin").
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
