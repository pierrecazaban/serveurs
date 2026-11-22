// Student accounts: /api/account?action=…
//   GET  me                                   → { student } or 401
//   POST setup    { pid, password }           → creates the account of a paid registration (pid = Stripe Checkout Session id, or Mollie payment id before)
//   POST login    { email, password }
//   POST logout
//   POST password { current_password, new_password }   (logged in)
//   POST forgot   { email }                   → always { ok: true }; emails a reset link if the account exists
//   POST reset    { token, password }
// One function for every action keeps the deployment under the Vercel function limit.
import { SCHOOL, send, readJson, rateLimited, clientIp, mapStatus, currentMode, siteOrigin } from "./_lib.js";
import { sql } from "./_db.js";
import { validPaymentId, canRead, getPayment } from "./_payments.js";
import {
  hashPassword,
  verifyPassword,
  validPassword,
  setSessionCookie,
  clearSessionCookie,
  currentStudent,
  resetToken,
  studentFromResetToken,
  publicStudent,
} from "./_auth.js";
import { sendPasswordResetEmail } from "./_email.js";

const normEmail = (v) => (typeof v === "string" ? v.trim().toLowerCase().slice(0, 160) : "");
const isUniqueViolation = (err) => err?.code === "23505";
// Same work as a real check, so response time does not reveal whether an email has an account.
const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86);

async function setup(req, res, b) {
  const pid = typeof b.pid === "string" ? b.pid : "";
  if (!validPaymentId(pid) || !canRead(pid)) return send(res, 400, { ok: false, error: "invalid" });
  if (!validPassword(b.password)) return send(res, 400, { ok: false, error: "weak_password" });
  let p;
  try {
    p = await getPayment(pid);
  } catch (err) {
    if (err?.status === 404) return send(res, 404, { ok: false, error: "not_found" });
    throw err;
  }
  const m = p.metadata || {};
  if (m.app !== SCHOOL.app) return send(res, 404, { ok: false, error: "not_found" });
  if (mapStatus(p) !== "paid") return send(res, 409, { ok: false, error: "not_paid" });

  const email = normEmail(m.em);
  const [existing] = await sql`SELECT id FROM students WHERE payment_id = ${p.id} OR (mode = ${p.mode} AND email = ${email})`;
  if (existing) return send(res, 409, { ok: false, error: "exists" });
  try {
    // nostats: a payment the statistics leave out (api/school/register.js), so api/track.js leaves the account out too.
    const [student] = await sql`
      INSERT INTO students (mode, email, first_name, last_name, lang, payment_id, public_ref, password_hash, last_login_at, nostats)
      VALUES (${p.mode}, ${email}, ${m.fn || ""}, ${m.ln || ""}, ${m.lang === "fr" ? "fr" : "en"}, ${p.id}, ${m.ref || null},
              ${await hashPassword(b.password)}, now(), ${Boolean(m.nostats)})
      RETURNING *`;
    setSessionCookie(res, student);
    return send(res, 200, { ok: true, student: publicStudent(student) });
  } catch (err) {
    if (isUniqueViolation(err)) return send(res, 409, { ok: false, error: "exists" });
    throw err;
  }
}

async function login(req, res, b) {
  const email = normEmail(b.email);
  if (rateLimited(`login:${clientIp(req)}`, 20) || rateLimited(`login:${email}`, 8)) {
    return send(res, 429, { ok: false, error: "rate_limited" });
  }
  const password = typeof b.password === "string" ? b.password : "";
  const [student] = email ? await sql`SELECT * FROM students WHERE mode = ${currentMode()} AND email = ${email}` : [];
  const ok = await verifyPassword(password, student?.password_hash ?? DUMMY_HASH);
  if (!student || !ok) return send(res, 401, { ok: false, error: "invalid" });
  await sql`UPDATE students SET last_login_at = now() WHERE id = ${student.id}`;
  setSessionCookie(res, student);
  return send(res, 200, { ok: true, student: publicStudent(student) });
}

async function changePassword(req, res, b) {
  const student = await currentStudent(req);
  if (!student) return send(res, 401, { ok: false, error: "unauthorized" });
  if (rateLimited(`password:${student.id}`, 10)) return send(res, 429, { ok: false, error: "rate_limited" });
  if (!(await verifyPassword(String(b.current_password ?? ""), student.password_hash))) {
    return send(res, 401, { ok: false, error: "wrong_password" });
  }
  if (!validPassword(b.new_password)) return send(res, 400, { ok: false, error: "weak_password" });
  const [updated] = await sql`
    UPDATE students SET password_hash = ${await hashPassword(b.new_password)},
           password_version = password_version + 1, updated_at = now()
    WHERE id = ${student.id} RETURNING *`;
  setSessionCookie(res, updated);
  return send(res, 200, { ok: true });
}

async function forgot(req, res, b) {
  const email = normEmail(b.email);
  if (rateLimited(`forgot:${clientIp(req)}`, 10) || rateLimited(`forgot:${email}`, 3)) {
    return send(res, 429, { ok: false, error: "rate_limited" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { ok: false, error: "invalid_email" });
  const [student] = await sql`SELECT * FROM students WHERE mode = ${currentMode()} AND email = ${email}`;
  if (student) {
    try {
      const sent = await sendPasswordResetEmail(student, resetToken(student), siteOrigin(req));
      if (!sent) console.warn("[account] reset email not sent: email is not configured");
    } catch (err) {
      console.error("[account] reset email failed", err?.status, err?.message);
    }
  }
  // Same answer whether or not the account exists.
  return send(res, 200, { ok: true });
}

async function reset(req, res, b) {
  if (rateLimited(`reset:${clientIp(req)}`, 20)) return send(res, 429, { ok: false, error: "rate_limited" });
  const student = await studentFromResetToken(b.token);
  if (!student) return send(res, 400, { ok: false, error: "invalid_token" });
  if (!validPassword(b.password)) return send(res, 400, { ok: false, error: "weak_password" });
  const [updated] = await sql`
    UPDATE students SET password_hash = ${await hashPassword(b.password)},
           password_version = password_version + 1, updated_at = now(), last_login_at = now()
    WHERE id = ${student.id} RETURNING *`;
  setSessionCookie(res, updated);
  return send(res, 200, { ok: true, student: publicStudent(updated) });
}

export default async function handler(req, res) {
  const action = new URL(req.url, "http://x").searchParams.get("action") || "";
  try {
    if (req.method === "GET" && action === "me") {
      const student = await currentStudent(req);
      return student ? send(res, 200, { student: publicStudent(student) }) : send(res, 401, { error: "unauthorized" });
    }
    if (req.method !== "POST") return send(res, 405, { ok: false });
    const b = await readJson(req);
    switch (action) {
      case "setup": return await setup(req, res, b);
      case "login": return await login(req, res, b);
      case "logout": clearSessionCookie(res); return send(res, 200, { ok: true });
      case "password": return await changePassword(req, res, b);
      case "forgot": return await forgot(req, res, b);
      case "reset": return await reset(req, res, b);
      default: return send(res, 404, { ok: false, error: "unknown_action" });
    }
  } catch (err) {
    console.error("[account]", action, err?.code || err?.status, err?.message);
    return send(res, 500, { ok: false, error: "error" });
  }
}
