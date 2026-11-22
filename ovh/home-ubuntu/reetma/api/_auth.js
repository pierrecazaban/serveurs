// Student accounts: password hashing, session cookie and password-reset links.
// SESSION_SECRET (Vercel env, 32+ random bytes) signs both the cookie and the reset links.
import crypto from "node:crypto";
import { promisify } from "node:util";
import { sql } from "./_db.js";

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;

export const PASSWORD_MIN = 8;
const COOKIE = "reetma_session";
const SESSION_DAYS = 30;
const RESET_MINUTES = 60;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(actual, expected);
}

export function validPassword(password) {
  return typeof password === "string" && password.length >= PASSWORD_MIN && password.length <= 200;
}

// ---- Signed tokens: base64url(JSON payload) + "." + HMAC ----
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw Object.assign(new Error("SESSION_SECRET is not configured"), { code: "no_secret" });
  return s;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function unsign(token, purpose) {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  if (expected.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.purpose !== purpose || !(payload.exp > Date.now())) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---- Session cookie (httpOnly: never readable by page scripts) ----
function cookieValue(req) {
  const match = String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

export function setSessionCookie(res, student) {
  const token = sign({ purpose: "session", sid: student.id, v: student.password_version, exp: Date.now() + SESSION_DAYS * 86400e3 });
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

/** The logged-in student, or null. A password change invalidates every older session. */
export async function currentStudent(req) {
  const payload = unsign(cookieValue(req), "session");
  if (!payload) return null;
  const [student] = await sql`SELECT * FROM students WHERE id = ${payload.sid}`;
  if (!student || student.password_version !== payload.v) return null;
  return student;
}

// ---- Password-reset links (single use: they carry the password version) ----
export function resetToken(student) {
  return sign({ purpose: "reset", sid: student.id, v: student.password_version, exp: Date.now() + RESET_MINUTES * 60e3 });
}

export async function studentFromResetToken(token) {
  const payload = unsign(token, "reset");
  if (!payload) return null;
  const [student] = await sql`SELECT * FROM students WHERE id = ${payload.sid}`;
  if (!student || student.password_version !== payload.v) return null;
  return student;
}

/** What the browser may see about a student. */
export function publicStudent(s) {
  return {
    first_name: s.first_name,
    last_name: s.last_name,
    email: s.email,
    lang: s.lang,
    public_ref: s.public_ref,
    created_at: s.created_at,
  };
}
