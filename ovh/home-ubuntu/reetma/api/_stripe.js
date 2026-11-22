// Stripe, the payment provider of L'École since November 2026 (Mollie before: its payments stay readable).
// The registration fee is paid on a Stripe Checkout page; a Checkout Session (cs_live_… / cs_test_…) is a
// registration, with the student's details in its metadata, exactly like a Mollie payment before.
//   STRIPE_SECRET_KEY      sk_live_… in production, sk_test_… while testing (never sent to the browser)
//   STRIPE_WEBHOOK_SECRET  optional whsec_…: when set, webhook calls must carry a valid Stripe-Signature
import crypto from "node:crypto";

const API = "https://api.stripe.com/v1";

export function stripeKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  return key && /^(sk|rk)_(test|live)_[A-Za-z0-9]{20,}$/.test(key) ? key : null;
}

export const STRIPE_SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

/** Stripe's form encoding: { a: { b: [1] } } → a[b][0]=1. Undefined and null values are left out. */
function encode(value, prefix, out) {
  if (value === undefined || value === null) return out;
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) encode(v, prefix ? `${prefix}[${k}]` : k, out);
  } else {
    out.append(prefix, String(value));
  }
  return out;
}

export async function stripe(path, { method = "GET", body } = {}) {
  const key = stripeKey();
  if (!key) throw Object.assign(new Error("STRIPE_SECRET_KEY is not configured"), { code: "no_key" });
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2024-06-20",
    },
    body: body ? encode(body, "", new URLSearchParams()).toString() : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Stripe error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Stripe metadata values are strings: give back the types the rest of the code reads (as Mollie stored them).
const NUMERIC = ["mkt", "grad", "nostats"];
function metadataOf(session) {
  const m = { ...(session.metadata || {}) };
  for (const k of NUMERIC) if (m[k] !== undefined && m[k] !== "") m[k] = Number(m[k]);
  return m;
}

const money = (cents) => (cents / 100).toFixed(2);

/**
 * A Checkout Session in the shape of a Mollie payment, which the whole site reads:
 * { id, provider, mode, status, amount: { value, currency }, amountRefunded, paidAt, createdAt, metadata }.
 */
export function paymentFromSession(s) {
  const charge = s.payment_intent && typeof s.payment_intent === "object" ? s.payment_intent.latest_charge : null;
  const paid = s.payment_status === "paid" || s.payment_status === "no_payment_required";
  let status = "open";
  if (s.status === "complete" && paid) status = "paid";
  else if (s.status === "expired") status = "expired";
  else if (s.payment_intent?.status === "canceled") status = "canceled";
  const currency = String(s.currency || "eur").toUpperCase();
  const refunded = charge && typeof charge === "object" ? charge.amount_refunded : 0;
  const paidAt = charge && typeof charge === "object" && charge.created ? charge.created : paid ? s.created : null;
  return {
    id: s.id,
    provider: "stripe",
    mode: s.livemode ? "live" : "test",
    status,
    amount: { value: money(s.amount_total ?? 0), currency },
    amountRefunded: refunded ? { value: money(refunded), currency } : undefined,
    paidAt: status === "paid" && paidAt ? new Date(paidAt * 1000).toISOString() : undefined,
    createdAt: new Date(s.created * 1000).toISOString(),
    metadata: metadataOf(s),
  };
}

const EXPAND = "expand[]=payment_intent.latest_charge";

export async function getStripePayment(id) {
  return paymentFromSession(await stripe(`/checkout/sessions/${encodeURIComponent(id)}?${EXPAND}`));
}

/** Writes the whole metadata back (strings only; a value set to "" removes the key). */
export async function setStripeMetadata(id, metadata) {
  const strings = {};
  for (const [k, v] of Object.entries(metadata)) strings[k] = v === undefined || v === null ? "" : String(v);
  await stripe(`/checkout/sessions/${encodeURIComponent(id)}`, { method: "POST", body: { metadata: strings } });
}

/** Every Checkout Session of the account, newest first (pages of 100, at most `maxPages`). */
export async function listStripePayments(maxPages = 20) {
  const out = [];
  let after = null;
  for (let i = 0; i < maxPages; i += 1) {
    const page = await stripe(
      `/checkout/sessions?limit=100&expand[]=data.payment_intent.latest_charge${after ? `&starting_after=${after}` : ""}`,
    );
    for (const s of page.data ?? []) out.push(paymentFromSession(s));
    if (!page.has_more || !page.data?.length) break;
    after = page.data[page.data.length - 1].id;
  }
  return out;
}

/** Checks the Stripe-Signature header of a webhook call against STRIPE_WEBHOOK_SECRET (5 min tolerance). */
export function validStripeSignature(rawBody, header) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return true; // without the secret, the session is still reloaded from the API, never trusted
  const parts = Object.fromEntries(
    String(header || "")
      .split(",")
      .map((kv) => kv.split("="))
      .filter((kv) => kv.length === 2),
  );
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const sigs = String(header)
    .split(",")
    .filter((kv) => kv.startsWith("v1="))
    .map((kv) => kv.slice(3));
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
