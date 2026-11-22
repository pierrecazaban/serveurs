// Back-office session: email and password are checked by /api/admin/login, which returns a signed
// token valid 12 hours. The token is kept in this tab only (sessionStorage).
import { setTrackingOptOut } from "@/lib/track";

const KEY = "reetma_admin_token";

export function getAdminToken(): string | null {
  try {
    const t = sessionStorage.getItem(KEY);
    if (!t) return null;
    const exp = Number(t.split(".")[0]);
    if (!exp || exp < Date.now()) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return t;
  } catch {
    return null;
  }
}

export function clearAdminToken() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export async function adminLogin(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.ok && data.token) {
      try {
        sessionStorage.setItem(KEY, data.token);
      } catch {
        /* storage unavailable: session lasts until reload */
      }
      // Every tab of this browser, "Voir le site" included, stays out of the audience (AdminLayout sets it again).
      setTrackingOptOut(true);
      return { ok: true };
    }
    return { ok: false, error: data.error || "invalid" };
  } catch {
    return { ok: false, error: "network" };
  }
}

export async function adminFetch<T>(path: string, init?: { method: "POST"; body: unknown }): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token ?? ""}`,
      ...(init ? { "Content-Type": "application/json" } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401) {
    clearAdminToken();
    throw Object.assign(new Error("unauthorized"), { status: 401 });
  }
  if (!res.ok) throw Object.assign(new Error("request_failed"), { status: res.status });
  return (await res.json()) as T;
}

/** True when adminFetch failed because the session expired (401), not because of the server. */
export const isUnauthorized = (error: unknown) => (error as { status?: number } | null)?.status === 401;

/** POST to a back-office endpoint with the admin token. */
export const adminPost = <T>(path: string, body: unknown) => adminFetch<T>(path, { method: "POST", body });
