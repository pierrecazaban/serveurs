// POST /api/school/stripe-webhook  (Stripe event, JSON; endpoint registered in Stripe → Developers → Webhooks,
// events checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.expired and
// charge.refunded). Only the Checkout Session id is taken from the event: the session is always reloaded from
// the Stripe API. With STRIPE_WEBHOOK_SECRET set, the Stripe-Signature header must be valid too.
import { send } from "../_lib.js";
import { STRIPE_SESSION_ID, stripe, stripeKey, getStripePayment, validStripeSignature } from "../_stripe.js";
import { onPaymentUpdate } from "../_registrationPaid.js";

export const config = { api: { bodyParser: false } }; // the signature covers the raw body

async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (typeof req.body === "string") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

/** The Checkout Session the event is about, or "" (a refund points at a payment intent). */
async function sessionIdOf(event) {
  const o = event?.data?.object || {};
  if (String(event?.type || "").startsWith("checkout.session.")) return String(o.id || "");
  if (event?.type === "charge.refunded" && typeof o.payment_intent === "string") {
    const list = await stripe(`/checkout/sessions?limit=1&payment_intent=${encodeURIComponent(o.payment_intent)}`);
    return String(list.data?.[0]?.id || "");
  }
  return "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { ok: false });
  const raw = await rawBody(req);
  if (!stripeKey()) return send(res, 200, { ok: true });
  if (!validStripeSignature(raw, req.headers["stripe-signature"])) return send(res, 400, { ok: false });
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return send(res, 400, { ok: false });
  }
  try {
    const id = await sessionIdOf(event);
    if (!STRIPE_SESSION_ID.test(id)) return send(res, 200, { ok: true });
    await onPaymentUpdate(await getStripePayment(id), req);
    return send(res, 200, { ok: true });
  } catch (err) {
    if (err?.status === 404) return send(res, 200, { ok: true });
    // Stripe retries non-2xx answers for 3 days: what we want if its API or Resend was briefly unreachable.
    console.error("[stripe-webhook] error", err?.status, err?.message);
    return send(res, 500, { ok: false });
  }
}
