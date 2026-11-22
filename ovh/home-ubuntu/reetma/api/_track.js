// Audience measurement for the back office: which page each visit is on right now, and the sales funnel.
// Shared by api/track.js (beats from the browser, stats for /admin) and the Mollie webhook ("paid" step);
// api/school/register.js marks the payments the statistics leave out (fromExcludedCountry).
// Tables presence and funnel_events: db/schema.sql. Browser side: src/lib/presence.ts.
import { sql } from "./_db.js";

/** Visit id made by the browser: 22 random base64url characters (16 to 40 accepted). */
export const VISIT_ID = /^[A-Za-z0-9_-]{16,40}$/;

/** Countries (ISO 3166-1 alpha-2 codes) whose visits and payments the statistics never count. */
export const EXCLUDED_COUNTRIES = [];

/**
 * True when the request comes from one of EXCLUDED_COUNTRIES, as located by Vercel from the IP address
 * (x-vercel-ip-country, on every request; absent in local dev). The country is only read here, never stored.
 */
export function fromExcludedCountry(req) {
  return [].concat(req.headers["x-vercel-ip-country"]).some((c) => {
    if (typeof c !== "string") return false;
    // Case and spaces do not matter, in the header as in the list.
    const code = c.trim().toUpperCase();
    return EXCLUDED_COUNTRIES.some((x) => x.trim().toUpperCase() === code);
  });
}

/** Records the first time a visit reaches a step of the funnel; later repeats are ignored. */
export async function insertFunnelEvent(mode, visitorId, event, lang) {
  await sql`
    INSERT INTO funnel_events (mode, visitor_id, event, lang)
    VALUES (${mode}, ${visitorId}, ${event}, ${lang === "en" || lang === "fr" ? lang : null})
    ON CONFLICT DO NOTHING`;
}

// Pages as the back office names them, in both languages (routes in src/App.tsx).
const PAGES = [
  ["home", "Accueil", ["/"]],
  ["school_en", "L'École (EN)", ["/school"]],
  ["school_fr", "L'École (FR)", ["/ecole"]],
  ["confirmation", "Création du mot de passe", ["/school/confirmation", "/ecole/confirmation"]],
  ["login", "Connexion", ["/school/login", "/ecole/connexion"]],
  ["reset", "Nouveau mot de passe", ["/school/reset-password", "/ecole/nouveau-mot-de-passe"]],
  ["account", "Espace étudiant", ["/school/account", "/ecole/compte"]],
  ["test", "Test final", ["/school/account/test", "/ecole/compte/test"]],
  ["certificate", "Certificat", ["/school/account/certificate", "/ecole/compte/certificat"]],
  ["help", "Centre d'aide", ["/help", "/aide"]],
  ["terms", "Conditions", ["/school/terms", "/ecole/conditions"]],
  ["refund", "Remboursement", ["/school/refund-policy", "/ecole/remboursement"]],
];
const BY_PATH = new Map(PAGES.flatMap(([key, label, paths]) => paths.map((p) => [p, { key, label }])));

/**
 * Stable key and French label of the page a visit is on. The registration form is part of L'École's page: there,
 * `form` gives its step (form_1 to form_4, 4 = payment step). A visit gone to pay ("mollie") has a page of its own.
 */
export function pageOf(path, step) {
  if (step === "mollie") return { key: "mollie", label: "Sur la page de paiement Stripe" };
  // Like React Router: case and a trailing slash do not matter.
  const p = String(path).toLowerCase().replace(/(.)\/+$/, "$1");
  const page = BY_PATH.get(p);
  if (/^form_[1-4]$/.test(step ?? "") && (page?.key === "school_en" || page?.key === "school_fr")) {
    return { ...page, form: step };
  }
  if (page) return page;
  const module = /^\/(?:school\/account|ecole\/compte)\/module\/([1-9]\d?)$/.exec(p);
  if (module) return { key: `module_${module[1]}`, label: `Module ${module[1]}` };
  if (/^\/certificate?\/[^/]+$/.test(p)) return { key: "verify", label: "Vérification de certificat" };
  if (p.startsWith("/legal/")) return { key: "legal", label: "Pages légales" };
  return { key: "other", label: "Autre page" };
}
