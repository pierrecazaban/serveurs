// Student space API (/api/student, session cookie). Errors carry the HTTP status and the server's error code.
import { SCHOOL_PATHS, type SchoolLang } from "@/lib/school/lang";

export interface CourseModule {
  key: string;
  title: string;
  summary: string;
  completed: boolean;
  completed_at: string | null;
}

export interface TestState {
  status: "locked" | "available" | "passed";
  best_score: number | null;
  total: number;
  pass_score: number;
  pass_percent: number;
  max_attempts: number;
  attempts_left: number;
}

export interface CertificateInfo {
  code: string;
  full_name: string;
  issued_at: string;
}

export interface Course {
  modules: CourseModule[];
  test: TestState;
  certificate: CertificateInfo | null;
}

export interface ModuleContent {
  key: string;
  title: string;
  summary: string;
  objectives: string[];
  body: string;
  completed: boolean;
  completed_at: string | null;
  prev_key: string | null;
  next_key: string | null;
}

export interface TestQuestion {
  id: string;
  prompt: string;
  options: string[];
}

export interface TestData {
  test: TestState;
  questions: TestQuestion[];
  certificate: CertificateInfo | null;
}

export interface SubmitResult {
  score: number;
  total: number;
  percent: number;
  passed: boolean;
  pass_score: number;
  pass_percent: number;
  attempts_left: number;
  certificate: CertificateInfo | null;
}

export interface CertificateDetails {
  certificate: CertificateInfo;
  name: string;
  title: string;
  organization: { name: string; id: string };
  skills: string[];
}

export interface PublicCertificate {
  valid: true;
  code: string;
  full_name: string;
  issued_at: string;
  name: string;
}

export class StudentApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

async function request<T>(action: string, lang: SchoolLang, init?: { body: unknown }, extra = ""): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/student?action=${action}&lang=${lang}${extra}`, {
      method: init ? "POST" : "GET",
      headers: init ? { "Content-Type": "application/json" } : undefined,
      body: init ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new StudentApiError(0, "network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new StudentApiError(res.status, data?.error || "error");
  return data as T;
}

export const fetchCourse = (lang: SchoolLang) => request<Course>("course", lang);
export const fetchModule = (lang: SchoolLang, key: string) => request<ModuleContent>("module", lang, undefined, `&key=${encodeURIComponent(key)}`);
export const completeModule = (lang: SchoolLang, key: string) => request<{ ok: true }>("complete", lang, { body: { key } });
export const fetchTest = (lang: SchoolLang) => request<TestData>("test", lang);
export const submitTest = (lang: SchoolLang, answers: Record<string, number>) => request<SubmitResult>("submit", lang, { body: { answers } });
export const fetchCertificate = (lang: SchoolLang) => request<CertificateDetails>("certificate", lang);

/** Public check of a certificate number (no login). */
export async function verifyCertificate(code: string): Promise<PublicCertificate | null> {
  const res = await fetch(`/api/certificate?code=${encodeURIComponent(code)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new StudentApiError(res.status, "error");
  return (await res.json()) as PublicCertificate;
}

export function formatDate(iso: string, lang: SchoolLang): string {
  return new Date(iso).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
}

/** Year and month (1-12) of a date in Paris time, for the LinkedIn form. */
export function issueYearMonth(iso: string): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", year: "numeric", month: "numeric" }).formatToParts(new Date(iso));
  return {
    year: Number(parts.find((p) => p.type === "year")?.value),
    month: Number(parts.find((p) => p.type === "month")?.value),
  };
}

/** Public verification page of a certificate (the link given to LinkedIn). Always on the production domain. */
export function certificateVerifyUrl(lang: SchoolLang, code: string): string {
  return `https://reetma-agency.com${SCHOOL_PATHS[lang].verify}/${code}`;
}
