// /api/admin/tickets — help-center tickets for the back office (admin token required).
//   GET                        → { mode, tickets, counts }  (?status=open|answered|closed|all, ?counts=1 for counts only)
//                                 ?status=calls: booked calls, upcoming first (soonest first), then past or cancelled
//   GET ?id=…                  → { ticket, messages }
//   POST ?action=reply  { id, body }    → stores the answer, emails it, status becomes "answered"
//   POST ?action=status { id, status }  → open | answered | closed
//   POST ?action=cancel_call { id }     → cancels an upcoming call (frees the slot, emails the booker, closes the ticket)
// Only tickets of the current mode are visible: live in production, test in previews.
import { send, readJson, verifyAdminToken, currentMode, siteOrigin } from "../_lib.js";
import { sql } from "../_db.js";
import { sendTicketReplyEmail } from "../_ticketEmails.js";
import { sendCallReplyEmail } from "../_bookingEmails.js";
import { BOOKING } from "../_booking.js";
import { cancelCall } from "../_bookingApi.js";

const STATUSES = ["open", "answered", "closed"];
const validId = (v) => /^\d{1,18}$/.test(String(v ?? ""));

// A call is upcoming until it ends.
const upcomingFrom = () => new Date(Date.now() - BOOKING.durationMinutes * 60e3).toISOString();

async function counts(mode) {
  const rows = await sql`
    SELECT status, count(*)::int AS n,
           count(*) FILTER (WHERE call_at > ${upcomingFrom()} AND call_cancelled_at IS NULL)::int AS calls
    FROM tickets WHERE mode = ${mode} GROUP BY status`;
  const out = { open: 0, answered: 0, closed: 0, all: 0, calls: 0 };
  for (const r of rows) {
    out[r.status] = r.n;
    out.all += r.n;
    out.calls += r.calls;
  }
  return out;
}

async function list(res, url, mode) {
  if (url.searchParams.get("counts") === "1") return send(res, 200, { mode, counts: await counts(mode) });
  const status = url.searchParams.get("status") || "all";
  if (status !== "all" && status !== "calls" && !STATUSES.includes(status)) return send(res, 400, { error: "invalid_status" });
  const from = upcomingFrom();
  const tickets = await sql`
    SELECT t.id, t.number, t.name, t.email, t.lang, t.category, t.reference, t.subject, t.status,
           t.created_at, t.updated_at, t.student_id IS NOT NULL AS has_account,
           t.company, t.role, t.phone, t.call_at, t.call_tz, t.call_cancelled_at, t.call_cancelled_by,
           last.author AS last_author, left(last.body, 200) AS last_message,
           (SELECT count(*)::int FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count
    FROM tickets t
    LEFT JOIN LATERAL (
      SELECT author, body FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1
    ) last ON true
    WHERE t.mode = ${mode}
      AND (${status} = 'all' OR t.status = ${status} OR (${status} = 'calls' AND t.call_at IS NOT NULL))
    ORDER BY
      -- Calls: upcoming ones first, soonest first; then past or cancelled ones, latest first.
      CASE WHEN ${status} = 'calls' THEN (t.call_at <= ${from} OR t.call_cancelled_at IS NOT NULL) END,
      CASE WHEN ${status} = 'calls' AND t.call_at > ${from} AND t.call_cancelled_at IS NULL THEN t.call_at END,
      CASE WHEN ${status} = 'calls' THEN t.call_at END DESC,
      t.updated_at DESC
    LIMIT 500`;
  return send(res, 200, { mode, tickets, counts: await counts(mode) });
}

async function detail(res, id, mode) {
  if (!validId(id)) return send(res, 400, { error: "invalid_id" });
  const [ticket] = await sql`
    SELECT id, number, name, email, lang, category, reference, subject, status, created_at, updated_at,
           student_id IS NOT NULL AS has_account,
           company, role, phone, call_at, call_tz, call_cancelled_at, call_cancelled_by
    FROM tickets WHERE id = ${id} AND mode = ${mode}`;
  if (!ticket) return send(res, 404, { error: "not_found" });
  const messages = await sql`
    SELECT id, author, body, created_at FROM ticket_messages WHERE ticket_id = ${id} ORDER BY created_at, id`;
  return send(res, 200, { ticket, messages });
}

async function reply(req, res, b, mode) {
  const body = typeof b.body === "string" ? b.body.trim() : "";
  if (!validId(b.id)) return send(res, 400, { ok: false, error: "invalid_id" });
  if (!body || body.length > 10000) return send(res, 400, { ok: false, error: "invalid_body" });
  // Answer stored and ticket updated in one statement.
  const [row] = await sql`
    WITH m AS (
      INSERT INTO ticket_messages (ticket_id, author, body)
      SELECT id, 'admin', ${body} FROM tickets WHERE id = ${b.id} AND mode = ${mode}
      RETURNING id, ticket_id
    ), u AS (
      UPDATE tickets SET status = 'answered', updated_at = now()
      WHERE id IN (SELECT ticket_id FROM m)
      RETURNING id, number, name, email, lang, call_at, call_tz, call_cancelled_at
    )
    SELECT u.*, m.id AS message_id FROM u, m`;
  if (!row) return send(res, 404, { ok: false, error: "not_found" });

  let emailed = false;
  let emailError = null;
  try {
    // On a booked call (e.g. the video-call link), the email comes from Reetma and names the call (cancelled or not).
    const sendReply = row.call_at ? sendCallReplyEmail : sendTicketReplyEmail;
    emailed = await sendReply(row, body, row.message_id, siteOrigin(req));
    if (!emailed) emailError = "not_configured";
  } catch (err) {
    emailError = "send_failed";
    console.error("[admin/tickets] reply email failed", row.number, err?.status, err?.message);
  }
  return send(res, 200, { ok: true, emailed, email_error: emailError });
}

async function setStatus(res, b, mode) {
  if (!validId(b.id)) return send(res, 400, { ok: false, error: "invalid_id" });
  if (!STATUSES.includes(b.status)) return send(res, 400, { ok: false, error: "invalid_status" });
  const [row] = await sql`
    UPDATE tickets SET status = ${b.status}, updated_at = now()
    WHERE id = ${b.id} AND mode = ${mode} RETURNING id, status`;
  if (!row) return send(res, 404, { ok: false, error: "not_found" });
  return send(res, 200, { ok: true, status: row.status });
}

async function cancelCallAction(req, res, b, mode) {
  if (!validId(b.id)) return send(res, 400, { ok: false, error: "invalid_id" });
  const result = await cancelCall({ id: String(b.id), mode, by: "admin" }, siteOrigin(req));
  if (!result.ok) return send(res, result.status, { ok: false, error: result.error });
  return send(res, 200, { ok: true, emailed: result.emailed, email_error: result.emailError });
}

export default async function handler(req, res) {
  if (!verifyAdminToken(req)) return send(res, 401, { error: "unauthorized" });
  const url = new URL(req.url, "http://x");
  const mode = currentMode();
  try {
    if (req.method === "GET") {
      const id = url.searchParams.get("id");
      return id ? await detail(res, id, mode) : await list(res, url, mode);
    }
    if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
    const b = await readJson(req);
    const action = url.searchParams.get("action");
    if (action === "reply") return await reply(req, res, b, mode);
    if (action === "status") return await setStatus(res, b, mode);
    if (action === "cancel_call") return await cancelCallAction(req, res, b, mode);
    return send(res, 404, { error: "unknown_action" });
  } catch (err) {
    console.error("[admin/tickets]", err?.code || err?.status, err?.message);
    return send(res, 500, { error: "db_error" });
  }
}
