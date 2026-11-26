/**
 * Client-side JSON helpers for the app UI (Module A).
 * Same envelope contract as `handleApi`: `{ ...data }` on success,
 * `{ message }` is thrown as an Error on failure.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: "no-store",
    ...init,
    ...(init?.body !== undefined
      ? { headers: { "Content-Type": "application/json" } }
      : {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message || "Requête impossible");
  return data;
}

export const getJson = <T>(path: string) => request<T>(path);
export const postJson = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });
export const patchJson = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const deleteJson = <T>(path: string) =>
  request<T>(path, { method: "DELETE" });
