// What happens when a registration payment changes status, for both webhooks (api/school/stripe-webhook.js for the
// new payments, api/school/mollie-webhook.js for the ones made on Mollie before). `p` is always reloaded from the
// provider's API (api/_payments.js), never trusted from the webhook request.
// Once paid, the payment joins the back-office funnel (keyed by a hash of the payment id: no link to a browsing
// visit; not with metadata.nostats, see register.js) and the student gets a confirmation email; metadata.mail
// records that it was sent. Throws when the email could not be sent, so the provider calls again later.
import crypto from "node:crypto";
import { SCHOOL, mapStatus, siteOrigin } from "./_lib.js";
import { setPaymentMetadata } from "./_payments.js";
import { sendRegistrationEmail } from "./_email.js";
import { insertFunnelEvent } from "./_track.js";

export async function onPaymentUpdate(p, req) {
  const m = p.metadata || {};
  if (m.app !== SCHOOL.app) return;
  const status = mapStatus(p);
  console.log("[webhook]", p.id, m.ref, p.mode, p.status, "->", status);
  if (status !== "paid") return;
  if (!m.nostats) {
    // Funnel "Paiement réussi", once per payment. The measurement must never make the webhook fail.
    // nostats: registered from a country the statistics leave out (EXCLUDED_COUNTRIES in api/_track.js).
    try {
      const key = crypto.createHash("sha256").update(p.id).digest("base64url").slice(0, 22);
      await insertFunnelEvent(p.mode, key, "paid", m.lang);
    } catch (err) {
      console.error("[webhook] funnel event not recorded", p.id, err?.code, err?.message);
    }
  }
  if (!m.mail && (await sendRegistrationEmail(p, siteOrigin(req)))) {
    console.log("[webhook] confirmation email sent", p.id, m.ref);
    await setPaymentMetadata(p, { ...m, mail: new Date().toISOString() }).catch((err) =>
      console.error("[webhook] could not flag email as sent", p.id, err?.status, err?.message),
    );
  }
}
