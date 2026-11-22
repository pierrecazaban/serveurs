// L'École exists in English and French. The language comes from the URL, so the shared components
// (form, payment step, confirmation, help center, student space) follow the page they are on.
import { useLocation } from "react-router-dom";

export type SchoolLang = "en" | "fr";

// Keep in sync with PATHS in api/_lib.js (links inside emails).
export const SCHOOL_PATHS = {
  en: {
    home: "/school",
    confirmation: "/school/confirmation",
    terms: "/school/terms",
    refund: "/school/refund-policy",
    help: "/help",
    login: "/school/login",
    reset: "/school/reset-password",
    account: "/school/account",
    module: "/school/account/module",
    test: "/school/account/test",
    certificate: "/school/account/certificate",
    verify: "/certificate",
    book: "/book-a-call",
    bookCancel: "/book-a-call/cancel",
  },
  fr: {
    home: "/ecole",
    confirmation: "/ecole/confirmation",
    terms: "/ecole/conditions",
    refund: "/ecole/remboursement",
    help: "/aide",
    login: "/ecole/connexion",
    reset: "/ecole/nouveau-mot-de-passe",
    account: "/ecole/compte",
    module: "/ecole/compte/module",
    test: "/ecole/compte/test",
    certificate: "/ecole/compte/certificat",
    verify: "/certificat",
    book: "/prendre-rendez-vous",
    bookCancel: "/prendre-rendez-vous/annuler",
  },
} as const;

export function schoolLangOf(pathname: string): SchoolLang {
  return ["/ecole", "/aide", "/certificat", "/prendre-rendez-vous"].some((p) => pathname === p || pathname.startsWith(`${p}/`)) ? "fr" : "en";
}

export function useSchoolLang(): SchoolLang {
  return schoolLangOf(useLocation().pathname);
}

/** Path of the same page in the other language, for the language switch and hreflang links. */
export function alternateSchoolPath(pathname: string): string {
  const from = schoolLangOf(pathname);
  const to: SchoolLang = from === "fr" ? "en" : "fr";
  const keys = Object.keys(SCHOOL_PATHS[from]) as (keyof typeof SCHOOL_PATHS.en)[];
  // Longest prefix first, so /ecole/compte/test does not match /ecole/compte.
  for (const key of keys.sort((a, b) => SCHOOL_PATHS[from][b].length - SCHOOL_PATHS[from][a].length)) {
    const base = SCHOOL_PATHS[from][key];
    if (pathname === base || pathname.startsWith(`${base}/`)) return SCHOOL_PATHS[to][key] + pathname.slice(base.length);
  }
  return SCHOOL_PATHS[to].home;
}

// Intake names are stored in English (Mollie metadata, back office).
const INTAKE_FR: Record<string, string> = { "Fall 2026": "Automne 2026" };

export function intakeLabel(name: string | undefined, lang: SchoolLang): string {
  if (!name) return "";
  return lang === "fr" ? (INTAKE_FR[name] ?? name) : name;
}

export function formatEuros(cents: number, lang: SchoolLang): string {
  const value = (cents / 100).toFixed(2);
  return lang === "fr" ? `${value.replace(".", ",")} €` : `€${value}`;
}
