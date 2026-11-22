// Student account API (/api/account). The session is an httpOnly cookie set by the server:
// page scripts never see it, they only call these endpoints.
import type { SchoolLang } from "@/lib/school/lang";

export interface Student {
  first_name: string;
  last_name: string;
  email: string;
  lang: SchoolLang;
  public_ref: string | null;
  created_at: string;
}

export type AccountError =
  | "invalid"
  | "weak_password"
  | "wrong_password"
  | "not_found"
  | "not_paid"
  | "exists"
  | "invalid_email"
  | "invalid_token"
  | "rate_limited"
  | "unauthorized"
  | "error";

export type AccountResult<T = object> = ({ ok: true } & T) | { ok: false; error: AccountError };

export const PASSWORD_MIN = 8;

async function call<T>(action: string, body?: unknown): Promise<AccountResult<T>> {
  try {
    const res = await fetch(`/api/account?action=${action}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, ...(data as T) };
    return { ok: false, error: (data?.error as AccountError) || "error" };
  } catch {
    return { ok: false, error: "error" };
  }
}

export async function fetchMe(): Promise<Student | null> {
  const res = await call<{ student: Student }>("me");
  return res.ok ? res.student : null;
}

export const setupAccount = (pid: string, password: string) => call<{ student: Student }>("setup", { pid, password });
export const login = (email: string, password: string) => call<{ student: Student }>("login", { email, password });
export const logout = () => call("logout", {});
export const changePassword = (current_password: string, new_password: string) =>
  call("password", { current_password, new_password });
export const requestPasswordReset = (email: string) => call("forgot", { email });
export const resetPassword = (token: string, password: string) => call<{ student: Student }>("reset", { token, password });
