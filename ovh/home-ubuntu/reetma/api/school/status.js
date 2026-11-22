// GET /api/school/status?pid=cs_… (Stripe) or tr_… (Mollie, before)  → status of a registration payment
// (for the confirmation page)
import { SCHOOL, send, mapStatus } from "../_lib.js";
import { validPaymentId, canRead, getPayment } from "../_payments.js";
import { sql } from "../_db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { status: "not_found" });
  const url = new URL(req.url, "http://x");
  const pid = url.searchParams.get("pid") || "";
  if (!validPaymentId(pid) || !canRead(pid)) return send(res, 200, { status: "not_found" });
  try {
    const p = await getPayment(pid);
    const m = p.metadata || {};
    if (m.app !== SCHOOL.app) return send(res, 200, { status: "not_found" });
    let hasAccount = false;
    try {
      hasAccount = (await sql`SELECT 1 FROM students WHERE payment_id = ${p.id}`).length > 0;
    } catch (err) {
      console.error("[status] database error", err?.message);
    }
    return send(res, 200, {
      status: mapStatus(p),
      first_name: m.fn,
      email: m.em,
      university_name: m.uni,
      intake_name: m.intake,
      public_ref: m.ref,
      amount_paid_cents: p.status === "paid" ? Math.round(Number(p.amount.value) * 100) : undefined,
      currency: p.amount?.currency,
      paid_at: p.paidAt,
      lang: m.lang === "fr" ? "fr" : "en",
      has_account: hasAccount,
    });
  } catch (err) {
    if (err?.status === 404) return send(res, 200, { status: "not_found" });
    console.error("[status] payment provider error", err?.status, err?.message);
    return send(res, 502, { status: "not_found" });
  }
}
