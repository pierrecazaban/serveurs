// POST /api/school/register
// Validates the student's details and creates a Stripe Checkout Session for the registration fee.
// Returns the Stripe Checkout URL; the browser then sends the student to Stripe.
import crypto from "node:crypto";
import { SCHOOL, PATHS, langOf, siteOrigin, send, readJson, rateLimited, clientIp } from "../_lib.js";
import { stripe, stripeKey } from "../_stripe.js";
import { fromExcludedCountry } from "../_track.js";
import { UNIVERSITIES } from "../_universities.js";

const str = (v, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { result: "error" });
  // Without the database, a paid student could not open an account: take no payment then.
  if (!SCHOOL.paymentsOpen || !stripeKey() || !process.env.DATABASE_URL) {
    return send(res, 503, { result: "payments_unavailable" });
  }
  if (rateLimited(`reg:${clientIp(req)}`)) return send(res, 429, { result: "rate_limited" });

  const b = await readJson(req);
  if (str(b.website, 200)) return send(res, 200, { result: "error" }); // honeypot

  const d = {
    university_id: str(b.university_id, 40),
    first_name: str(b.first_name, 80),
    last_name: str(b.last_name, 80),
    email: str(b.email, 160).toLowerCase(),
    phone_e164: str(b.phone_e164, 20),
    major: str(b.major, 120),
    graduation_year: Number(b.graduation_year) || null,
    heard_about: str(b.heard_about, 60),
    timezone: str(b.timezone, 60),
  };

  const errors = {};
  if (!UNIVERSITIES[d.university_id]) errors.university_id = "Select your university.";
  if (!d.first_name) errors.first_name = "Enter your first name.";
  if (!d.last_name) errors.last_name = "Enter your last name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errors.email = "Enter a valid email address.";
  if (!/^\+[1-9]\d{6,14}$/.test(d.phone_e164)) errors.phone_national = "Enter a valid phone number.";
  if (b.terms_accepted !== true) errors.terms_accepted = "Accept the terms to continue.";
  if (b.withdrawal_waiver !== true) errors.withdrawal_waiver = "Confirm immediate access to continue.";
  if (b.age_confirmed !== true) errors.age_confirmed = "Confirm that you are 18 or older.";
  if (b.independence_acknowledged !== true) errors.independence_acknowledged = "Tick this box to continue.";
  if (Object.keys(errors).length) return send(res, 400, { result: "invalid", errors });

  const lang = langOf(b.lang); // page the student registered from: /school (en) or /ecole (fr)
  const ref = "ECO-" + crypto.randomBytes(4).toString("hex").toUpperCase();
  const origin = siteOrigin(req);
  const utm = b.utm && typeof b.utm === "object" ? b.utm : {};
  const now = new Date().toISOString();

  // Stripe metadata: 50 keys, 500 characters per value, strings only (api/_stripe.js reads the numbers back).
  const metadata = {
    app: SCHOOL.app,
    ref,
    fn: d.first_name,
    ln: d.last_name,
    em: d.email,
    ph: d.phone_e164,
    uid: d.university_id,
    uni: UNIVERSITIES[d.university_id].slice(0, 80),
    intake: SCHOOL.intakeName,
    major: d.major.slice(0, 60) || undefined,
    grad: d.graduation_year || undefined,
    heard: d.heard_about || undefined,
    utm: str(utm.utm_source, 40) || undefined,
    mkt: b.marketing_opt_in === true ? "1" : "0",
    terms: str(b.terms_version, 20) || SCHOOL.termsVersion,
    waiver: now, // immediate access requested + right of withdrawal waived (checkbox)
    lang,
    nostats: fromExcludedCountry(req) ? "1" : undefined, // the webhook leaves the payment out of the statistics
  };

  try {
    // Stripe puts the session id in place of {CHECKOUT_SESSION_ID}: the return page reads it from ?pid=.
    const expires = Math.floor(Date.now() / 1000) + 30 * 60; // 30 min, Stripe's minimum
    const session = await stripe("/checkout/sessions", {
      method: "POST",
      body: {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: SCHOOL.currency.toLowerCase(),
              unit_amount: Math.round(Number(SCHOOL.amount) * 100),
              product_data: { name: `L'École by Reetma · ${SCHOOL.intakeName}` },
            },
          },
        ],
        customer_email: d.email,
        client_reference_id: ref,
        locale: lang === "fr" ? "fr" : "en",
        success_url: `${origin}${PATHS[lang].confirmation}?pid={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}${PATHS[lang].home}`,
        expires_at: expires,
        metadata,
        payment_intent_data: { description: `L'École by Reetma · ${ref}`, metadata: { app: SCHOOL.app, ref } },
      },
    });

    return send(res, 200, {
      result: "reserved",
      registration_id: session.id,
      public_ref: ref,
      client_token: "",
      checkout_url: session.url,
      hold_expires_at: new Date(expires * 1000).toISOString(),
      intake_name: SCHOOL.intakeName,
    });
  } catch (err) {
    console.error("[register] Stripe error", err?.status, err?.message);
    return send(res, 502, { result: "error" });
  }
}
