// The booking calendar's requests, served by api/help.js (the calendar adds no serverless function: the plan allows 12).
//   GET  ?action=slots              → { ok, timezone, durationMinutes, horizonDays, slots: [ISO UTC of the free slots] }
//   POST ?action=book               { name, email, company, role?, phone?, message, business: true, start, tz, lang,
//                                     website (honeypot) } → { ok, number, start }  (409: slot_taken, already_booked)
//   GET  ?action=booking&t=TOKEN    → { ok, number, start, durationMinutes, timezone, status }  (read only: never cancels)
//   POST ?action=cancel             { t } → { ok, number, start }  (409: already_cancelled, past)
// A booking is a ticket of category "call", answered from /admin/tickets like any request. Bookings of the test mode
// (previews) and of the live mode never see each other: every query filters on the mode.
import crypto from "node:crypto";
import { send, readJson, rateLimited, clientIp, currentMode, siteOrigin, langOf } from "./_lib.js";
import { sql, transaction } from "./_db.js";
import { BOOKING, candidateSlots, iso, parseSlot, readCancelToken, validTimeZone } from "./_booking.js";
import { businessVerdict } from "./_bookingFilter.js";
import { sendCallBookedEmail, sendCallCancelledEmail } from "./_bookingEmails.js";

// Same ticket numbers as api/help.js (no I/O/0/1: they are read out loud and typed by hand).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ticketNumber = () => "T-" + Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
// Characters nobody types in a form: C0/C1 controls (a NUL makes Postgres fail), DEL, and the bidi embeddings,
// overrides and isolates (they make a value display as something else in the back office).
const HIDDEN = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/g;
// One-line fields: hidden characters dropped, any run of white space (tab, line break, no-break space…) → one space.
const cleanLine = (v) => (typeof v === "string" ? v.replace(HIDDEN, "").replace(/\s+/g, " ").trim() : "");
// The message keeps its line breaks and tabs.
const cleanText = (v) => (typeof v === "string" ? v.replace(/\r\n?|[\v\f\u2028\u2029]/g, "\n").replace(HIDDEN, "").trim() : "");
// Characters that display as nothing (zero-width space, Hangul fillers, variation selectors…) never count as typed
// text. The stored values keep them: a ZWJ inside an emoji or a ZWNJ inside Persian text comes with real letters.
const shown = (v) => v.replace(/\p{Default_Ignorable_Code_Point}/gu, "");
// A name or a company has at least one letter or digit that displays (not only invisible characters).
const VISIBLE = /[\p{L}\p{N}]/u;
const visible = (v) => VISIBLE.test(shown(v));
// A plain ASCII address, exactly what the email provider delivers to (no "Name <…>", no ";", no IDN look-alikes).
const EMAIL_RE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
// Lenient: digits and the usual separators, 6 to 20 digits.
const PHONE_RE = /^\+?[\d\s().\-/]{6,30}$/;

const callMs = () => BOOKING.durationMinutes * 60e3;

/**
 * Starts (ms) among the candidate slots that overlap a booked call, every call being taken to last
 * BOOKING.durationMinutes (no length is stored per call): moving the hours or lengthening the calls never offers a
 * time that overlaps a call already booked (shortening them can: see BOOKING in api/_booking.js).
 */
async function takenSlots(mode, candidates) {
  if (!candidates.length) return new Set();
  const span = callMs();
  const rows = await sql`
    SELECT call_at FROM tickets
    WHERE mode = ${mode} AND call_cancelled_at IS NULL
      AND call_at > ${iso(candidates[0] - span)} AND call_at < ${iso(candidates[candidates.length - 1] + span)}`;
  const calls = rows.map((r) => new Date(r.call_at).getTime());
  return new Set(candidates.filter((s) => calls.some((c) => c > s - span && c < s + span)));
}

async function slots(req, res) {
  if (rateLimited(`slots:${clientIp(req)}`, 60)) return send(res, 429, { ok: false, error: "rate_limited" });
  const candidates = candidateSlots(Date.now());
  const taken = await takenSlots(currentMode(), candidates);
  return send(res, 200, {
    ok: true,
    timezone: BOOKING.timezone,
    durationMinutes: BOOKING.durationMinutes,
    horizonDays: BOOKING.horizonDays, // the page's day grid shows that many days after today
    slots: candidates.filter((s) => !taken.has(s)).map(iso),
  });
}

// Fields are cleaned (hidden characters, white space), never cut: a value over its limit is refused, like in the form.
function validate(b) {
  const d = {
    name: cleanLine(b.name),
    email: typeof b.email === "string" ? b.email.trim().toLowerCase() : "",
    company: cleanLine(b.company),
    role: cleanLine(b.role) || null,
    phone: cleanLine(b.phone),
    message: cleanText(b.message),
    lang: langOf(b.lang),
    tz: validTimeZone(b.tz),
    start: parseSlot(b.start),
  };
  const errors = {};
  if (!visible(d.name)) errors.name = "required";
  else if (d.name.length > 100) errors.name = "too_long";
  if (d.email.length > 160 || !EMAIL_RE.test(d.email)) errors.email = "invalid";
  if (d.company.length < 2) errors.company = d.company ? "too_short" : "required";
  else if (d.company.length > 120) errors.company = "too_long";
  else if (!visible(d.company)) errors.company = "invalid";
  if (d.role && d.role.length > 100) errors.role = "too_long";
  if (d.phone) {
    const digits = d.phone.replace(/\D/g, "").length;
    if (!PHONE_RE.test(d.phone) || digits < 6 || digits > 20) errors.phone = "invalid";
  }
  d.phone = d.phone || null;
  const typed = shown(d.message).trim(); // the 20-character minimum counts what displays
  if (typed.length < 20) errors.message = typed ? "too_short" : "required";
  else if (d.message.length > 2000) errors.message = "too_long";
  if (b.business !== true) errors.business = "required";
  if (d.start === null) errors.start = "invalid";
  return { d, errors };
}

async function book(req, res) {
  if (rateLimited(`book:${clientIp(req)}`, 6)) return send(res, 429, { ok: false, error: "rate_limited" });
  const b = (await readJson(req)) ?? {};
  // Bots fill the hidden field: pretend it worked, store nothing.
  if (str(b.website, 200)) return send(res, 200, { ok: true, number: ticketNumber(), start: str(b.start, 40) });

  const { d, errors } = validate(b);
  if (Object.keys(errors).length) return send(res, 400, { ok: false, error: "invalid", fields: errors });
  const verdict = businessVerdict(d);
  if (!verdict.ok) {
    console.log("[help] booking refused: not a business", verdict.field);
    return send(res, 400, { ok: false, error: "business_only", field: verdict.field });
  }

  // The start must be one of the slots the calendar offers right now, and still free.
  const mode = currentMode();
  const candidates = candidateSlots(Date.now());
  if (!candidates.includes(d.start)) return send(res, 400, { ok: false, error: "invalid_slot" });
  if ((await takenSlots(mode, [d.start])).has(d.start)) return send(res, 409, { ok: false, error: "slot_taken" });

  const start = iso(d.start);
  // A call already booked that overlaps this one (the same start, or a nearby one after a change of the hours).
  const overlapFrom = iso(d.start - callMs());
  const overlapTo = iso(d.start + callMs());
  let ticket = null;
  for (let attempt = 0; attempt < 5 && !ticket; attempt += 1) {
    const number = ticketNumber();
    try {
      const [, [state], rows] = await transaction((q) => [
        // One booking at a time per mode: the checks below see every call booked before this one, even under load
        // (one upcoming call per email, no overlapping calls).
        q`SELECT pg_advisory_xact_lock(hashtext(${`reetma-call:${mode}`}))`,
        q`SELECT
            EXISTS (
              SELECT 1 FROM tickets
              WHERE mode = ${mode} AND call_cancelled_at IS NULL AND call_at > ${overlapFrom} AND call_at < ${overlapTo}
            ) AS taken`,
        // Ticket and first message in one statement, like a help-center request.
        q`WITH t AS (
            INSERT INTO tickets (mode, number, name, email, lang, category, subject, company, role, phone, call_at, call_tz)
            SELECT ${mode}, ${number}, ${d.name}, ${d.email}, ${d.lang}, 'call', ${d.company}, ${d.company}, ${d.role},
                   ${d.phone}, ${start}::timestamptz, ${d.tz}
            WHERE NOT EXISTS (
              SELECT 1 FROM tickets
              WHERE mode = ${mode} AND email = ${d.email} AND call_at > now() AND call_cancelled_at IS NULL
            ) AND NOT EXISTS (
              SELECT 1 FROM tickets
              WHERE mode = ${mode} AND call_cancelled_at IS NULL AND call_at > ${overlapFrom} AND call_at < ${overlapTo}
            )
            RETURNING id
          )
          INSERT INTO ticket_messages (ticket_id, author, body)
          SELECT id, 'student', ${d.message} FROM t
          RETURNING ticket_id`,
      ]);
      if (!rows.length) return send(res, 409, { ok: false, error: state.taken ? "slot_taken" : "already_booked" });
      ticket = { id: String(rows[0].ticket_id), number };
    } catch (err) {
      if (err?.code !== "23505") throw err;
      // The unique index of db/schema.sql: someone booked this slot a moment ago.
      if (/tickets_call_slot_idx/.test(`${err.constraint ?? ""} ${err.message ?? ""}`)) {
        return send(res, 409, { ok: false, error: "slot_taken" });
      }
      // Otherwise a ticket-number collision: try another number.
    }
  }
  if (!ticket) throw new Error("could not allocate a ticket number");

  try {
    const sent = await sendCallBookedEmail({ ...d, ...ticket }, siteOrigin(req));
    if (!sent) console.warn("[help] call email not sent: email is not configured", ticket.number);
  } catch (err) {
    console.error("[help] call email failed", ticket.number, err?.code || err?.status, err?.message);
  }
  console.log("[help] call booked", ticket.number, start, d.lang);
  return send(res, 200, { ok: true, number: ticket.number, start });
}

/** What the cancel page shows: no name, email or message (the link may have been forwarded). */
async function bookingInfo(req, res) {
  if (rateLimited(`booking:${clientIp(req)}`, 30)) return send(res, 429, { ok: false, error: "rate_limited" });
  const ref = readCancelToken(new URL(req.url, "http://x").searchParams.get("t"));
  if (!ref) return send(res, 400, { ok: false, error: "invalid_token" });
  const [t] = await sql`
    SELECT number, call_at, call_tz, call_cancelled_at FROM tickets
    WHERE id = ${ref.id} AND number = ${ref.number} AND mode = ${currentMode()} AND call_at IS NOT NULL`;
  if (!t) return send(res, 404, { ok: false, error: "not_found" });
  const start = new Date(t.call_at).getTime();
  return send(res, 200, {
    ok: true,
    number: t.number,
    start: iso(start),
    durationMinutes: BOOKING.durationMinutes,
    timezone: t.call_tz,
    status: t.call_cancelled_at ? "cancelled" : start <= Date.now() ? "past" : "upcoming",
  });
}

async function cancel(req, res) {
  if (rateLimited(`cancel:${clientIp(req)}`, 10)) return send(res, 429, { ok: false, error: "rate_limited" });
  const b = (await readJson(req)) ?? {};
  const ref = readCancelToken(b.t);
  if (!ref) return send(res, 400, { ok: false, error: "invalid_token" });
  const result = await cancelCall({ ...ref, mode: currentMode(), by: "booker" }, siteOrigin(req));
  if (!result.ok) return send(res, result.status, { ok: false, error: result.error });
  return send(res, 200, { ok: true, number: result.call.number, start: iso(result.call.start) });
}

/**
 * Cancels an upcoming call, which frees its slot, and emails the booker. Also used by the back office (by: "admin").
 * A cancellation by the booker reopens the ticket, so that it shows in the back office's open tickets;
 * one made from the back office closes it.
 */
export async function cancelCall({ id, number = null, mode, by }, origin) {
  const [row] = await sql`
    UPDATE tickets
    SET call_cancelled_at = now(), call_cancelled_by = ${by}, status = ${by === "admin" ? "closed" : "open"}, updated_at = now()
    WHERE id = ${id} AND mode = ${mode} AND (${number}::text IS NULL OR number = ${number}::text)
      AND call_at IS NOT NULL AND call_cancelled_at IS NULL AND call_at > now()
    RETURNING id, number, name, email, lang, call_at, call_tz`;
  if (!row) {
    const [t] = await sql`
      SELECT call_at, call_cancelled_at FROM tickets
      WHERE id = ${id} AND mode = ${mode} AND (${number}::text IS NULL OR number = ${number}::text)`;
    if (!t?.call_at) return { ok: false, status: 404, error: "not_found" };
    return { ok: false, status: 409, error: t.call_cancelled_at ? "already_cancelled" : "past" };
  }
  const call = { ...row, id: String(row.id), start: new Date(row.call_at).getTime(), tz: row.call_tz };
  let emailed = false;
  let emailError = null;
  try {
    emailed = await sendCallCancelledEmail(call, by, origin);
    if (!emailed) emailError = "not_configured";
  } catch (err) {
    emailError = "send_failed";
    console.error("[help] cancellation email failed", call.number, err?.code || err?.status, err?.message);
  }
  console.log("[help] call cancelled", call.number, by);
  return { ok: true, call, emailed, emailError };
}

const HANDLERS = { "GET slots": slots, "POST book": book, "GET booking": bookingInfo, "POST cancel": cancel };

/** The handler of a booking request, or null when the request is not one. */
export const bookingHandler = (method, action) => HANDLERS[`${method} ${action}`] ?? null;
