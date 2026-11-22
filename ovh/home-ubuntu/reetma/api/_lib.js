// Shared helpers for the Reetma serverless functions (Vercel).
// Secrets come from Vercel environment variables, never from the browser:
//   STRIPE_SECRET_KEY  (sk_test_... while testing, sk_live_... in production): new payments, see api/_stripe.js
//   MOLLIE_API_KEY  (optional since the switch to Stripe: reads the registrations paid on Mollie)
//   MOLLIE_LEGACY_API_KEY  (optional: the previous Mollie account's key, read only, for the payments made there)
//   ADMIN_EMAIL + ADMIN_PASSWORD  (the single /admin back-office account)
import crypto from "node:crypto";

const MOLLIE = "https://api.mollie.com/v2";

export const SCHOOL = {
  app: "reetma-school",
  amount: "30.00",
  currency: "EUR",
  intakeName: "Fall 2026",
  termsVersion: "2026-10",
  // false: no new payment is created (register answers payments_unavailable). Pages: schoolFeatures.payments.
  paymentsOpen: true,
};

// Public pages per language (kept in sync with src/lib/school/lang.ts).
export const PATHS = {
  en: {
    home: "/school", confirmation: "/school/confirmation", help: "/help", login: "/school/login",
    reset: "/school/reset-password", account: "/school/account", certificate: "/school/account/certificate", verify: "/certificate",
    book: "/book-a-call", bookCancel: "/book-a-call/cancel",
  },
  fr: {
    home: "/ecole", confirmation: "/ecole/confirmation", help: "/aide", login: "/ecole/connexion",
    reset: "/ecole/nouveau-mot-de-passe", account: "/ecole/compte", certificate: "/ecole/compte/certificat", verify: "/certificat",
    book: "/prendre-rendez-vous", bookCancel: "/prendre-rendez-vous/annuler",
  },
};

export const langOf = (v) => (v === "fr" ? "fr" : "en");

/**
 * "live" with the live payment key (production), "test" otherwise (previews). Separates data in the database.
 * The Stripe key decides when it is set; the Mollie key otherwise (before the switch to Stripe).
 */
export function currentMode() {
  const stripe = process.env.STRIPE_SECRET_KEY;
  if (stripe) return /^(sk|rk)_live_/.test(stripe) ? "live" : "test";
  return (mollieKey() || "").startsWith("live_") ? "live" : "test";
}

const validKey = (key) => (key && /^(test|live)_[A-Za-z0-9]{20,}$/.test(key) ? key : null);

export function mollieKey() {
  return validKey(process.env.MOLLIE_API_KEY);
}

/** The previous Mollie account's key, in the same mode as MOLLIE_API_KEY: its payments stay readable. */
export function mollieLegacyKey() {
  const key = validKey(process.env.MOLLIE_LEGACY_API_KEY);
  const main = mollieKey();
  return key && main && key !== main && key.slice(0, 5) === main.slice(0, 5) ? key : null;
}

export async function mollie(path, { method = "GET", body, key: explicitKey } = {}) {
  const key = explicitKey || mollieKey();
  if (!key) throw Object.assign(new Error("MOLLIE_API_KEY is not configured"), { code: "no_key" });
  try {
    return await mollieRequest(key, path, method, body);
  } catch (err) {
    // A payment made on the previous Mollie account is unknown to the current one: look it up there.
    const legacy = mollieLegacyKey();
    if (err.status === 404 && !explicitKey && legacy && /^\/payments\/tr_/.test(path)) {
      return mollieRequest(legacy, path, method, body);
    }
    throw err;
  }
}

async function mollieRequest(key, path, method, body) {
  const res = await fetch(path.startsWith("http") ? path : MOLLIE + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(data?.detail || `Mollie error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function siteOrigin(req) {
  const env = process.env.SITE_URL;
  if (env) return env.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = host.startsWith("localhost") ? "http" : "https";
  return `${proto}://${host}`;
}

export function send(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

// Very small per-instance rate limit (best effort, serverless instances are short-lived).
const hits = new Map();
export function rateLimited(key, max = 8, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  entry.n += 1;
  return entry.n > max;
}

export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
}

// ---- Admin session tokens (stateless, signed with ADMIN_PASSWORD) ----
function adminSecret() {
  const p = process.env.ADMIN_PASSWORD;
  return p && p.length >= 8 ? `reetma-admin:${p}` : null;
}

const digest = (s) => crypto.createHash("sha256").update(s).digest();

// The email is compared case-insensitively; both checks always run so timing reveals nothing.
export function checkAdminCredentials(email, password) {
  const e = process.env.ADMIN_EMAIL;
  const p = process.env.ADMIN_PASSWORD;
  if (!e || !p || p.length < 8 || typeof email !== "string" || typeof password !== "string") return false;
  const emailOk = crypto.timingSafeEqual(digest(email.trim().toLowerCase()), digest(e.trim().toLowerCase()));
  const passwordOk = crypto.timingSafeEqual(digest(password), digest(p));
  return emailOk && passwordOk;
}

export function signAdminToken(hours = 12) {
  const secret = adminSecret();
  const exp = Date.now() + hours * 3600 * 1000;
  const sig = crypto.createHmac("sha256", secret).update(String(exp)).digest("hex");
  return `${exp}.${sig}`;
}

export function verifyAdminToken(req) {
  const secret = adminSecret();
  if (!secret) return false;
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = crypto.createHmac("sha256", secret).update(exp).digest("hex");
  if (expected.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

export function mapStatus(p) {
  if (!p) return "not_found";
  if (p.amountRefunded && Number(p.amountRefunded.value) > 0) return "refunded";
  switch (p.status) {
    case "paid": return "paid";
    case "failed": return "payment_failed";
    case "canceled": return "canceled";
    case "expired": return "expired";
    default: return "pending_payment"; // open, pending, authorized
  }
}
