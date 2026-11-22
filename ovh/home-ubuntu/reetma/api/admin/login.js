// POST /api/admin/login { email, password } → { token } (12 h session for the back office)
import { send, readJson, checkAdminCredentials, signAdminToken, rateLimited, clientIp } from "../_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { ok: false });
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) return send(res, 503, { ok: false, error: "not_configured" });
  if (rateLimited(`login:${clientIp(req)}`, 10)) return send(res, 429, { ok: false, error: "rate_limited" });
  const { email, password } = await readJson(req);
  if (!checkAdminCredentials(email, password)) return send(res, 401, { ok: false, error: "invalid" });
  return send(res, 200, { ok: true, token: signAdminToken() });
}
