// Student space: /api/student?action=… (logged-in students only, session cookie from api/account.js)
//   GET  course                 → the 3 modules with their state, the final-test state, the certificate
//   GET  module&key=1           → one module's content
//   POST complete { key }       → marks a module as done
//   GET  test                   → final-test questions, without answers, once the 3 modules are done
//   POST submit { answers }     → graded on the server; issues the certificate when passed
//   GET  certificate            → the student's certificate and what the LinkedIn form needs
// Texts come in ?lang= (en/fr), defaulting to the student's language.
// One function for every action keeps the deployment under the Vercel function limit.
import crypto from "node:crypto";
import { send, readJson, siteOrigin, langOf } from "./_lib.js";
import { sql } from "./_db.js";
import { currentStudent } from "./_auth.js";
import { MODULE_KEYS, moduleText, FINAL_TEST, PASS_SCORE, publicQuestions, gradeTest, CERTIFICATE } from "./_course.js";
import { sendCertificateEmail } from "./_certificateEmails.js";

async function courseState(student, lang) {
  const [progress, [stats], [certificate]] = await Promise.all([
    sql`SELECT module_key, completed_at FROM module_progress WHERE student_id = ${student.id}`,
    sql`SELECT max(score)::int AS best, coalesce(bool_or(passed), false) AS passed,
               (count(*) FILTER (WHERE created_at > now() - interval '24 hours'))::int AS recent
        FROM test_attempts WHERE student_id = ${student.id}`,
    sql`SELECT code, full_name, issued_at FROM certificates WHERE student_id = ${student.id}`,
  ]);
  const done = new Map(progress.map((r) => [r.module_key, r.completed_at]));
  const modules = MODULE_KEYS.map((key) => {
    const t = moduleText(key, lang);
    return { key, title: t.title, summary: t.summary, completed: done.has(key), completed_at: done.get(key) ?? null };
  });
  const allDone = modules.every((m) => m.completed);
  const passed = Boolean(stats?.passed || certificate);
  return {
    modules,
    test: {
      status: passed ? "passed" : allDone ? "available" : "locked",
      best_score: stats?.best ?? null,
      total: FINAL_TEST.questions.length,
      pass_score: PASS_SCORE,
      pass_percent: FINAL_TEST.passPercent,
      max_attempts: FINAL_TEST.maxAttemptsPerDay,
      attempts_left: Math.max(0, FINAL_TEST.maxAttemptsPerDay - (stats?.recent ?? 0)),
    },
    certificate: certificate ?? null,
  };
}

/** Creates the certificate once (code RE-XXXXXX, unique) and emails the student. */
async function issueCertificate(student, origin) {
  const fullName = `${student.first_name} ${student.last_name}`.trim();
  for (let i = 0; i < 5; i++) {
    const code = `RE-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const [created] = await sql`
      INSERT INTO certificates (student_id, code, full_name) VALUES (${student.id}, ${code}, ${fullName})
      ON CONFLICT DO NOTHING RETURNING code, full_name, issued_at`;
    if (created) {
      try {
        if (!(await sendCertificateEmail(student, created, origin))) console.warn("[student] certificate email not sent: email is not configured");
      } catch (err) {
        console.error("[student] certificate email failed", err?.status, err?.message);
      }
      return created;
    }
    // Nothing inserted: either the student already has a certificate, or the code was taken.
    const [existing] = await sql`SELECT code, full_name, issued_at FROM certificates WHERE student_id = ${student.id}`;
    if (existing) return existing;
  }
  throw new Error("could not allocate a certificate code");
}

async function getModule(res, student, lang, key) {
  if (!MODULE_KEYS.includes(key)) return send(res, 404, { error: "not_found" });
  const t = moduleText(key, lang);
  const [row] = await sql`SELECT completed_at FROM module_progress WHERE student_id = ${student.id} AND module_key = ${key}`;
  const i = MODULE_KEYS.indexOf(key);
  return send(res, 200, {
    key,
    title: t.title,
    summary: t.summary,
    objectives: t.objectives,
    body: t.body,
    completed: Boolean(row),
    completed_at: row?.completed_at ?? null,
    prev_key: MODULE_KEYS[i - 1] ?? null,
    next_key: MODULE_KEYS[i + 1] ?? null,
  });
}

async function completeModule(res, student, b) {
  const key = typeof b.key === "string" ? b.key : "";
  if (!MODULE_KEYS.includes(key)) return send(res, 404, { error: "not_found" });
  await sql`INSERT INTO module_progress (student_id, module_key) VALUES (${student.id}, ${key}) ON CONFLICT DO NOTHING`;
  return send(res, 200, { ok: true });
}

async function getTest(res, student, lang) {
  const state = await courseState(student, lang);
  if (state.test.status === "locked") return send(res, 403, { error: "locked", test: state.test });
  return send(res, 200, {
    test: state.test,
    questions: state.test.status === "available" ? publicQuestions(lang) : [],
    certificate: state.certificate,
  });
}

async function submitTest(req, res, student, lang, b) {
  const state = await courseState(student, lang);
  if (state.test.status === "locked") return send(res, 403, { error: "locked" });
  if (state.test.status === "passed") return send(res, 409, { error: "already_passed" });
  if (state.test.attempts_left <= 0) return send(res, 429, { error: "too_many_attempts", test: state.test });
  const graded = gradeTest(b.answers);
  if (!graded) return send(res, 400, { error: "incomplete" });
  await sql`
    INSERT INTO test_attempts (student_id, score, total, passed, answers)
    VALUES (${student.id}, ${graded.score}, ${graded.total}, ${graded.passed}, ${JSON.stringify(graded.clean)}::jsonb)`;
  const certificate = graded.passed ? await issueCertificate(student, siteOrigin(req)) : null;
  // Only the score goes back: which answers were right stays on the server.
  return send(res, 200, {
    score: graded.score,
    total: graded.total,
    percent: Math.round((graded.score / graded.total) * 100),
    passed: graded.passed,
    pass_score: PASS_SCORE,
    pass_percent: FINAL_TEST.passPercent,
    attempts_left: Math.max(0, state.test.attempts_left - 1),
    certificate,
  });
}

async function getCertificate(res, student, lang) {
  const [certificate] = await sql`SELECT code, full_name, issued_at FROM certificates WHERE student_id = ${student.id}`;
  if (!certificate) return send(res, 404, { error: "not_found" });
  return send(res, 200, {
    certificate,
    name: CERTIFICATE.name,
    title: CERTIFICATE.title,
    organization: { name: CERTIFICATE.organizationName, id: CERTIFICATE.organizationId },
    skills: CERTIFICATE.skills[lang],
  });
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const action = url.searchParams.get("action") || "";
  try {
    const student = await currentStudent(req);
    if (!student) return send(res, 401, { error: "unauthorized" });
    const lang = langOf(url.searchParams.get("lang") || student.lang);
    if (req.method === "GET") {
      switch (action) {
        case "course": return send(res, 200, await courseState(student, lang));
        case "module": return await getModule(res, student, lang, url.searchParams.get("key") || "");
        case "test": return await getTest(res, student, lang);
        case "certificate": return await getCertificate(res, student, lang);
        default: return send(res, 404, { error: "unknown_action" });
      }
    }
    if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
    const b = await readJson(req);
    switch (action) {
      case "complete": return await completeModule(res, student, b);
      case "submit": return await submitTest(req, res, student, lang, b);
      default: return send(res, 404, { error: "unknown_action" });
    }
  } catch (err) {
    console.error("[student]", action, err?.code || err?.status, err?.message);
    return send(res, 500, { error: "error" });
  }
}
