// GET /api/certificate?code=RE-XXXXXX → public check of a certificate (the page LinkedIn links to).
// Exposes only what the certificate itself shows: name, certificate title and issue date.
import { send, rateLimited, clientIp, currentMode } from "./_lib.js";
import { sql } from "./_db.js";
import { CERTIFICATE } from "./_course.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { valid: false });
  if (rateLimited(`verify:${clientIp(req)}`, 60)) return send(res, 429, { valid: false, error: "rate_limited" });
  const code = (new URL(req.url, "http://x").searchParams.get("code") || "").trim().toUpperCase();
  if (!/^RE-[0-9A-F]{6}$/.test(code)) return send(res, 404, { valid: false });
  try {
    const [row] = await sql`
      SELECT c.full_name, c.issued_at FROM certificates c JOIN students s ON s.id = c.student_id
      WHERE c.code = ${code} AND s.mode = ${currentMode()}`;
    if (!row) return send(res, 404, { valid: false });
    return send(res, 200, { valid: true, code, full_name: row.full_name, issued_at: row.issued_at, name: CERTIFICATE.name });
  } catch (err) {
    console.error("[certificate]", err?.code || err?.status, err?.message);
    return send(res, 500, { valid: false, error: "error" });
  }
}
