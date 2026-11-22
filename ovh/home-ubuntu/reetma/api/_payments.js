// One door to the registrations, whichever provider took the payment:
//   cs_…  Stripe Checkout Session (every new registration)
//   tr_…  Mollie payment (registrations paid before the switch to Stripe, still readable with MOLLIE_API_KEY)
// Both come back in the same shape (see paymentFromSession in api/_stripe.js).
import { mollie, mollieKey } from "./_lib.js";
import { STRIPE_SESSION_ID, stripeKey, getStripePayment, setStripeMetadata } from "./_stripe.js";

const MOLLIE_ID = /^tr_[A-Za-z0-9]{6,30}$/;

/** A payment id the site could have issued (format only). */
export const validPaymentId = (id) => typeof id === "string" && (STRIPE_SESSION_ID.test(id) || MOLLIE_ID.test(id));

/** True when the provider of this id is configured. */
export function canRead(id) {
  if (STRIPE_SESSION_ID.test(id)) return Boolean(stripeKey());
  if (MOLLIE_ID.test(id)) return Boolean(mollieKey());
  return false;
}

/** The payment, or a thrown error with status 404 when the provider does not know it. */
export async function getPayment(id) {
  if (STRIPE_SESSION_ID.test(id)) return getStripePayment(id);
  if (MOLLIE_ID.test(id)) return { ...(await mollie(`/payments/${id}`)), provider: "mollie" };
  throw Object.assign(new Error("unknown payment id"), { status: 404 });
}

export async function setPaymentMetadata(p, metadata) {
  if (p.provider === "stripe") return setStripeMetadata(p.id, metadata);
  return mollie(`/payments/${p.id}`, { method: "PATCH", body: { metadata } });
}
