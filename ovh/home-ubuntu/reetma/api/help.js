// POST /api/help?action=create — a help-center request (ticket), answered from /admin/tickets.
// { name, email, category, reference?, subject, message, lang, website (honeypot) } → { ok, number }
// The booking calendar's actions (slots, book, booking, cancel) are served here too: see api/_bookingApi.js.
import crypto from "node:crypto";
import { send, readJson, rateLimited, clientIp, currentMode, siteOrigin, langOf } from "./_lib.js";
import { sql } from "./_db.js";
import { currentStudent } from "./_auth.js";
import { sendTicketReceivedEmail } from "./_ticketEmails.js";
import { bookingHandler } from "./_bookingApi.js";

const CATEGORIES = ["account", "payment", "refund", "program", "certificate", "waitlist", "project", "other"];
// No I/O/0/1: numbers are read out loud and typed by hand.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const ticketNumber = () => "T-" + Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function validate(b) {
  const d = {
    name: str(b.name, 100),
    email: str(b.email, 160).toLowerCase(),
    category: str(b.category, 20),
    reference: str(b.reference, 40).toUpperCase() || null,
    subject: str(b.subject, 150),
    message: typeof b.message === "string" ? b.message.trim() : "",
    lang: langOf(b.lang),
  };
  const errors = {};
  if (!d.name) errors.name = "required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errors.email = "invalid";
  if (!CATEGORIES.includes(d.category)) errors.category = "invalid";
  if (d.reference && !/^[A-Z0-9-]{3,40}$/.test(d.reference)) errors.reference = "invalid";
  if (d.subject.length < 3) errors.subject = "too_short";
  if (d.message.length < 10) errors.message = "too_short";
  if (d.message.length > 5000) errors.message = "too_long";
  return { d, errors };
}

async function create(req, res) {
  if (rateLimited(`help:${clientIp(req)}`, 5)) return send(res, 429, { ok: false, error: "rate_limited" });
  const b = await readJson(req);
  // Bots fill the hidden field: pretend it worked, store nothing.
  if (str(b.website, 200)) return send(res, 200, { ok: true, number: ticketNumber() });

  const { d, errors } = validate(b);
  if (Object.keys(errors).length) return send(res, 400, { ok: false, error: "invalid", fields: errors });

  let studentId = null;
  try {
    studentId = (await currentStudent(req))?.id ?? null;
  } catch {
    /* no session secret or no database row: the ticket stays anonymous */
  }

  // Ticket and first message in one statement, so a ticket never exists without its message.
  let number = "";
  for (let attempt = 0; attempt < 5 && !number; attempt += 1) {
    const candidate = ticketNumber();
    try {
      await sql`
        WITH t AS (
          INSERT INTO tickets (mode, number, student_id, name, email, lang, category, reference, subject)
          VALUES (${currentMode()}, ${candidate}, ${studentId}, ${d.name}, ${d.email}, ${d.lang}, ${d.category},
                  ${d.reference}, ${d.subject})
          RETURNING id
        )
        INSERT INTO ticket_messages (ticket_id, author, body)
        SELECT id, 'student', ${d.message} FROM t`;
      number = candidate;
    } catch (err) {
      if (err?.code !== "23505") throw err; // retry only on a number collision
    }
  }
  if (!number) throw new Error("could not allocate a ticket number");

  try {
    const sent = await sendTicketReceivedEmail({ ...d, number }, d.message, siteOrigin(req));
    if (!sent) console.warn("[help] ticket email not sent: email is not configured", number);
  } catch (err) {
    console.error("[help] ticket email failed", number, err?.status, err?.message);
  }
  console.log("[help] ticket created", number, d.category, d.lang);
  return send(res, 200, { ok: true, number });
}

export default async function handler(req, res) {
  const action = new URL(req.url, "http://x").searchParams.get("action") || "";
  const booking = bookingHandler(req.method, action);
  if (!booking && (req.method !== "POST" || action !== "create")) return send(res, 405, { ok: false });
  try {
    return await (booking ? booking(req, res) : create(req, res));
  } catch (err) {
    console.error("[help]", err?.code || err?.status, err?.message);
    return send(res, 500, { ok: false, error: "error" });
  }
}
