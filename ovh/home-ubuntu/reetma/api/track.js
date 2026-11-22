// /api/track — audience measurement for the back office (no cookie, no IP address stored).
//   POST { v, path, step?, lang?, event? }    → always 204. A beat from src/lib/presence.ts: the page this visit
//                                               is on (every 60 s) and, with event, a step of the sales funnel
//   GET  ?action=stats&range=today|7d|30d|all → visitors online per page, student accounts, funnel (admin token)
//   POST ?action=reset                        → deletes this mode's presence and funnel events (admin token): every
//                                               count starts again from 0, the accounts tile included
//   GET  from the Vercel cron (vercel.json)   → deletes the rows past their retention, in both modes
// Only the current mode is counted: live in production, test in previews.
import { send, readJson, rateLimited, clientIp, currentMode, verifyAdminToken } from "./_lib.js";
import { sql } from "./_db.js";
import { VISIT_ID, fromExcludedCountry, insertFunnelEvent, pageOf } from "./_track.js";

const STEPS = ["form_1", "form_2", "form_3", "form_4", "mollie"];
const EVENTS = [
  "school_view", "register_start", "step_1_done", "step_2_done", "step_3_done", "pay_click",
  "registration_paid", "not_listed_submitted", "waitlist_submitted",
];
const RANGES = ["2h", "today", "7d", "30d", "all"];

// The registration form's steps (src/components/school/RegistrationForm.tsx), counted under L'École's page.
const FORM_STEPS = {
  form_1: "étape 1, université",
  form_2: "étape 2, coordonnées",
  form_3: "étape 3, vérification",
  form_4: "étape 4, paiement",
};

// Robots and audit tools that run JavaScript (Googlebot, Google's URL inspection, Lighthouse, headless browsers)
// are not visitors. "bot" must be followed by "/", ";" or "-" and not preceded by "cu": a Cubot phone stays a
// visitor, in the Instagram and Facebook in-app browsers too ("…; CUBOT; CUBOT P30; …", "FBMF/CUBOT;").
const ROBOT = /(?<!cu)bot[/;-]|crawl|spider|slurp|lighthouse|headless|prerender|inspectiontool|\+https?:/i;

// Sales funnel, in this order: visits of L'École (step_3_done: the payment step is shown; pay_click: the click on
// "Pay", just before leaving for Mollie; "paid" comes from the Mollie webhook), then students.
// "site": every visit of the site, whatever its first page (event site_view, recorded with the first beat).
const STAGES = [
  ["site", "Visite du site"],
  ["visit", "Visite de L'École"],
  ["form_start", "Formulaire commencé"],
  ["step_2", "Université choisie"],
  ["step_3", "Coordonnées remplies"],
  ["payment_step", "Étape paiement atteinte"],
  ["checkout", "Parti payer sur Stripe"],
  ["paid", "Paiement réussi"],
  ["account", "Compte créé"],
  ["module_1", "Module 1 terminé"],
  ["modules_done", "3 modules terminés"],
  ["test_passed", "Certificat obtenu"],
];

// Retention announced in Privacy.tsx: 48 h for presence, 13 months for funnel events. Purged by the beats (at most
// once an hour per instance), by the stats and, for the days without any visit, by the cron (vercel.json): twice a
// day, but on the Hobby plan at any minute of the hour and a run may be missed, so the next one can be 25 h away.
// Rows therefore go 25 h before their limit: none outlives it.
const purge = () =>
  Promise.all([
    sql`DELETE FROM presence WHERE updated_at < now() - interval '48 hours' + interval '25 hours'`,
    sql`DELETE FROM funnel_events WHERE created_at < now() - interval '13 months' + interval '25 hours'`,
  ]);
let purgedAt = 0;

// The cron sends Authorization: Bearer CRON_SECRET once that variable is set, and always x-vercel-cron-schedule. A page
// on another site cannot add a header to its request (the CORS preflight fails), and a purge only deletes expired rows.
function fromCron(req) {
  const secret = process.env.CRON_SECRET;
  return secret ? req.headers.authorization === `Bearer ${secret}` : Boolean(req.headers["x-vercel-cron-schedule"]);
}

async function record(req) {
  // Only this site's own JSON beats: another site can post text/plain without a preflight, never application/json.
  const json = String(req.headers["content-type"] || "").startsWith("application/json");
  if (!json || req.headers["sec-fetch-site"] === "cross-site") return;
  if (ROBOT.test(String(req.headers["user-agent"] || ""))) return;
  // Visits from the countries the statistics leave out are not recorded either (EXCLUDED_COUNTRIES in api/_track.js).
  if (fromExcludedCountry(req)) return;
  // Generous: a campus Wi-Fi puts a whole class behind one address, each tab beating every 60 s.
  if (rateLimited(`track:${clientIp(req)}`, 2400)) return;
  const b = await readJson(req);
  // Only the path: the query string and the hash carry payment ids, reset tokens and codes.
  const path = typeof b.path === "string" && b.path.startsWith("/") ? b.path.split(/[?#]/)[0].slice(0, 200) : "";
  // The back office and its sign-in page are never recorded.
  if (typeof b.v !== "string" || !VISIT_ID.test(b.v) || !path || /^\/+(admin|auth)/i.test(path)) return;
  // A certificate number names its holder and an unknown address can carry anything: only the kind of page is kept.
  const known = pageOf(path, null).key;
  const kept =
    known === "other" ? "/-"
    : known === "legal" ? (/^\/legal\/(mentions|privacy)\/?$/i.test(path) ? path : "/legal/-")
    : path.replace(/^\/(certificate?)\/[^/]+/i, "/$1/-");
  const mode = currentMode();
  const step = STEPS.includes(b.step) ? b.step : null;
  const lang = b.lang === "en" || b.lang === "fr" ? b.lang : null;
  await sql`
    INSERT INTO presence (mode, visitor_id, path, step, lang) VALUES (${mode}, ${b.v}, ${kept}, ${step}, ${lang})
    ON CONFLICT (mode, visitor_id) DO UPDATE
    SET path = EXCLUDED.path, step = EXCLUDED.step, lang = EXCLUDED.lang, updated_at = now()`;
  // Each visit of the site is counted once, at its first beat (later beats hit the primary key and change nothing).
  await insertFunnelEvent(mode, b.v, "site_view", lang);
  if (EVENTS.includes(b.event)) await insertFunnelEvent(mode, b.v, b.event, lang);
  // Also from the beats, at most once an hour per instance: retention must not depend on the back office being open.
  if (Date.now() - purgedAt > 60 * 60 * 1000) {
    purgedAt = Date.now();
    await purge();
  }
}

async function stats(range) {
  const mode = currentMode();
  // Retention (see purge): a visit's page only matters for a few minutes, funnel events 13 months at most.
  await purge();
  const [online, [counts]] = await Promise.all([
    // Online: a beat in the last 150 s (window_seconds below), or left for the Mollie payment page in the last 10 min
    // (MOLLIE_MS in src/lib/presence.ts): time enough to pay, and someone who paid but came back in another browser,
    // or not at all, is not counted there for long (nothing links the visit to the payment).
    sql`
      SELECT path, step, count(*)::int AS n FROM presence
      WHERE mode = ${mode} AND updated_at > now() - interval '10 minutes'
        AND (updated_at > now() - interval '150 seconds' OR step = 'mollie')
      GROUP BY path, step`,
    // Funnel: distinct visits (one row per visit and event), then distinct students. "today" starts at midnight in Paris.
    // Students only count from the first funnel event, like the visits: accounts opened before the measurement
    // (or more than 13 months ago) would put the funnel above 100 %. accounts counts the same way, since the last reset.
    // Accounts marked nostats (opened with a payment from EXCLUDED_COUNTRIES, see api/account.js) are never counted,
    // like their payment: neither in accounts nor at any stage after "paid".
    sql`
      WITH b AS (
        SELECT CASE ${range}::text
                 WHEN 'today' THEN date_trunc('day', now(), 'Europe/Paris')
                 WHEN '2h' THEN now() - interval '2 hours'
                 WHEN '7d' THEN now() - interval '7 days'
                 WHEN '30d' THEN now() - interval '30 days'
                 ELSE '-infinity'::timestamptz
               END AS since,
               (SELECT coalesce(min(created_at), now()) FROM funnel_events WHERE mode = ${mode}) AS tracked_since
      ),
      m AS (
        SELECT min(mp.completed_at) FILTER (WHERE mp.module_key = '1') AS module_1_at,
               (array_agg(mp.completed_at ORDER BY mp.completed_at))[3] AS third_at
        FROM module_progress mp JOIN students s ON s.id = mp.student_id
        WHERE s.mode = ${mode} AND NOT s.nostats
        GROUP BY mp.student_id
      )
      SELECT e.*,
             (SELECT count(*) FROM students, b WHERE mode = ${mode} AND NOT nostats AND created_at >= b.tracked_since)::int AS accounts,
             (SELECT count(*) FROM students, b
              WHERE mode = ${mode} AND NOT nostats AND created_at >= greatest(b.since, b.tracked_since))::int AS account,
             (SELECT count(*) FROM m, b WHERE m.module_1_at >= greatest(b.since, b.tracked_since))::int AS module_1,
             (SELECT count(*) FROM m, b WHERE m.third_at >= greatest(b.since, b.tracked_since))::int AS modules_done,
             (SELECT count(*) FROM certificates c JOIN students s ON s.id = c.student_id CROSS JOIN b
              WHERE s.mode = ${mode} AND NOT s.nostats AND c.issued_at >= greatest(b.since, b.tracked_since))::int AS test_passed
      FROM (
        SELECT (count(*) FILTER (WHERE event = 'site_view'))::int AS site,
               (count(*) FILTER (WHERE event = 'school_view'))::int AS visit,
               (count(*) FILTER (WHERE event = 'register_start'))::int AS form_start,
               (count(*) FILTER (WHERE event = 'step_1_done'))::int AS step_2,
               (count(*) FILTER (WHERE event = 'step_2_done'))::int AS step_3,
               (count(*) FILTER (WHERE event = 'step_3_done'))::int AS payment_step,
               (count(*) FILTER (WHERE event = 'pay_click'))::int AS checkout,
               (count(*) FILTER (WHERE event = 'paid'))::int AS paid
        FROM funnel_events, b WHERE mode = ${mode} AND created_at >= b.since
      ) e`,
  ]);

  // One row per page. On L'École's page, the visits in the registration form are also counted by step (form).
  const pages = new Map();
  for (const r of online) {
    const { form, ...page } = pageOf(r.path, r.step);
    const entry = pages.get(page.key) ?? { ...page, count: 0 };
    entry.count += r.n;
    if (form) {
      entry.form ??= [];
      const step = entry.form.find((s) => s.key === form);
      if (step) step.count += r.n;
      else entry.form.push({ key: form, label: FORM_STEPS[form], count: r.n });
    }
    pages.set(page.key, entry);
  }
  for (const p of pages.values()) p.form?.sort((a, b) => a.key.localeCompare(b.key));
  return {
    generated_at: new Date().toISOString(),
    mode,
    online: {
      total: online.reduce((sum, r) => sum + r.n, 0),
      window_seconds: 150,
      pages: [...pages.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "fr")),
    },
    accounts: { total: counts.accounts },
    funnel: { range, stages: STAGES.map(([key, label]) => ({ key, label, count: counts[key] })) },
  };
}

// Counts back to 0: the funnel and the stages after "paid" only count from the first funnel event (tracked_since).
async function reset(res) {
  const mode = currentMode();
  await sql`DELETE FROM presence WHERE mode = ${mode}`;
  await sql`DELETE FROM funnel_events WHERE mode = ${mode}`;
  return send(res, 200, { ok: true });
}

export default async function handler(req, res) {
  if (req.method === "POST" && new URL(req.url, "http://x").searchParams.get("action") === "reset") {
    if (!verifyAdminToken(req)) return send(res, 401, { error: "unauthorized" });
    try {
      return await reset(res);
    } catch (err) {
      console.error("[track] reset", err?.code, err?.message);
      return send(res, 500, { error: "error" });
    }
  }
  if (req.method === "POST") {
    try {
      await record(req);
    } catch (err) {
      console.error("[track] database error", err?.code, err?.message);
    }
    // Always the same answer: the browser has nothing to learn from it.
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    return res.end();
  }
  if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
  if (fromCron(req)) {
    if (rateLimited(`purge:${clientIp(req)}`)) return send(res, 429, { error: "rate_limited" });
    try {
      await purge();
      return send(res, 200, { ok: true });
    } catch (err) {
      console.error("[track] purge", err?.code, err?.message);
      return send(res, 500, { error: "error" });
    }
  }
  if (!verifyAdminToken(req)) return send(res, 401, { error: "unauthorized" });
  const url = new URL(req.url, "http://x");
  if (url.searchParams.get("action") !== "stats") return send(res, 404, { error: "unknown_action" });
  const range = RANGES.includes(url.searchParams.get("range")) ? url.searchParams.get("range") : "today";
  try {
    return send(res, 200, await stats(range));
  } catch (err) {
    console.error("[track] stats", err?.code || err?.status, err?.message);
    return send(res, 500, { error: "error" });
  }
}
