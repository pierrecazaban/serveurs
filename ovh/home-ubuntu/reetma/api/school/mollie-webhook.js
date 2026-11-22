// POST /api/school/mollie-webhook  (body: id=tr_xxx, form-encoded, sent by Mollie on every status change)
// Registrations paid on Mollie before the switch to Stripe (refunds, late notifications). The body only carries
// the payment id: the payment itself is always reloaded from the Mollie API. Then api/_registrationPaid.js.
import { mollieKey, send } from "../_lib.js";
import { getPayment } from "../_payments.js";
import { onPaymentUpdate } from "../_registrationPaid.js";

async function readPaymentId(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return String(req.body.id || "");
  let raw = typeof req.body === "string" || Buffer.isBuffer(req.body) ? String(req.body) : "";
  if (!raw && typeof req.on === "function") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    raw = Buffer.concat(chunks).toString("utf8");
  }
  return new URLSearchParams(raw).get("id") || "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { ok: false });
  const id = await readPaymentId(req);
  // Unknown or foreign ids still get a 200, so the endpoint does not reveal which payments exist.
  if (!/^tr_[A-Za-z0-9]{6,30}$/.test(id) || !mollieKey()) return send(res, 200, { ok: true });
  try {
    await onPaymentUpdate(await getPayment(id), req);
    return send(res, 200, { ok: true });
  } catch (err) {
    if (err?.status === 404) return send(res, 200, { ok: true });
    // Mollie retries non-2xx answers, which is what we want if its API or Resend was briefly unreachable.
    console.error("[webhook] error", err?.status, err?.message);
    return send(res, 500, { ok: false });
  }
}
