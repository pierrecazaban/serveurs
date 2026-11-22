import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Award, Check, ClipboardCheck, Lock, LogOut } from "lucide-react";
import { Seo } from "@/components/Seo";
import { HelpCenterLink } from "@/components/school/HelpCenterLink";
import { RequireStudent, useRefreshStudent } from "@/components/account/RequireStudent";
import { STUDENT_TEXT } from "@/components/account/studentText";
import { Eyebrow, Notice, PasswordField, StudentPage } from "@/components/account/StudentUi";
import { PRIMARY_STYLE, SECONDARY_STYLE, primaryButton, secondaryButton } from "@/components/account/studentStyles";
import { PASSWORD_MIN, changePassword, logout, type Student } from "@/lib/account";
import { StudentApiError, fetchCourse, type Course } from "@/lib/student";
import { SCHOOL_PATHS, useSchoolLang, type SchoolLang } from "@/lib/school/lang";

export default function StudentDashboard() {
  const lang = useSchoolLang();
  return <RequireStudent>{(student) => <Dashboard student={student} lang={lang} />}</RequireStudent>;
}

/** The single next step shown at the top of the page. */
function nextStep(course: Course, lang: SchoolLang) {
  const d = STUDENT_TEXT[lang].dashboard;
  const paths = SCHOOL_PATHS[lang];
  const done = course.modules.filter((m) => m.completed).length;
  const next = course.modules.find((m) => !m.completed);
  if (course.test.status === "passed") return { label: d.ctaCertificate, to: paths.certificate, intro: d.introPassed };
  if (!next) return { label: d.ctaTest, to: paths.test, intro: d.introTest };
  if (done === 0) return { label: d.ctaStart, to: `${paths.module}/${next.key}`, intro: d.introStart };
  return { label: d.ctaContinue(next.key), to: `${paths.module}/${next.key}`, intro: d.introContinue(done) };
}

function Dashboard({ student, lang }: { student: Student; lang: SchoolLang }) {
  const t = STUDENT_TEXT[lang];
  const d = t.dashboard;
  const paths = SCHOOL_PATHS[lang];
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refreshStudent = useRefreshStudent();
  const course = useQuery({ queryKey: ["student-course", lang], queryFn: () => fetchCourse(lang), staleTime: 0 });

  // Session expired in the meantime: back to the login page.
  useEffect(() => {
    if (course.error instanceof StudentApiError && course.error.status === 401) refreshStudent(null);
  }, [course.error, refreshStudent]);

  async function signOut() {
    await logout();
    queryClient.removeQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("student") });
    refreshStudent(null);
    navigate(paths.login, { replace: true });
  }

  const data = course.data;
  const step = data ? nextStep(data, lang) : null;
  const doneCount = data?.modules.filter((m) => m.completed).length ?? 0;
  const progress = data ? (doneCount + (data.test.status === "passed" ? 1 : 0)) / 4 : 0;

  return (
    <>
      <Seo title={d.seoTitle} description={d.seoTitle} path={paths.account} lang={lang} alternates={{ en: SCHOOL_PATHS.en.account, fr: SCHOOL_PATHS.fr.account }} noindex />
      <StudentPage>
        {/* 1. The next step, first thing on the page */}
        <section className="rounded-xl p-6 sm:p-8" style={{ background: "#1F3B36" }}>
          <p className="mb-2 font-heading text-sm font-bold" style={{ color: "#F28A4B" }}>
            {t.brand}
          </p>
          <h1 className="font-heading text-2xl font-bold sm:text-3xl" style={{ color: "#FBF7F0" }}>
            {d.hello(student.first_name)}
          </h1>
          {student.public_ref && (
            <p className="mt-1 text-xs" style={{ color: "#B9CBC4" }}>
              {d.reference(student.public_ref)}
            </p>
          )}
          {course.isLoading && <div className="mt-6 h-12 w-56 animate-pulse rounded" style={{ background: "#305D55" }} />}
          {step && (
            <>
              <p className="mt-5 text-base leading-relaxed" style={{ color: "#E3EDE7" }}>
                {step.intro}
              </p>
              <Link
                to={step.to}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 px-6 py-4 text-base font-bold sm:w-auto"
                style={{ background: "#F28A4B", color: "#1F3B36" }}
              >
                {step.label}
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
              <div className="mt-6 h-1.5 w-full rounded-full" style={{ background: "#305D55" }} aria-hidden="true">
                <div className="h-1.5 rounded-full transition-all" style={{ width: `${progress * 100}%`, background: "#F28A4B" }} />
              </div>
            </>
          )}
          {course.isError && !(course.error instanceof StudentApiError && course.error.status === 401) && (
            <p className="mt-5 text-sm" style={{ color: "#FECACA" }}>
              {d.loadError}
            </p>
          )}
        </section>

        {/* 2. The whole course */}
        {data && (
          <section className="mt-12">
            <h2 className="mb-5 font-heading text-xl font-bold" style={{ color: "#1F3B36" }}>
              {d.training}
            </h2>
            <ol className="space-y-3">
              {data.modules.map((m) => (
                <li key={m.key}>
                  <Link
                    to={`${paths.module}/${m.key}`}
                    className="flex items-start gap-4 rounded-lg border bg-white p-4 transition-colors hover:bg-[#FBF6EE] sm:p-5"
                    style={{ borderColor: "#ECE5D9" }}
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                      style={m.completed ? { background: "#305D55", color: "#FFFFFF" } : { background: "#F5EFE5", color: "#305D55" }}
                    >
                      {m.completed ? <Check className="h-4 w-4" aria-hidden="true" /> : m.key}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold uppercase tracking-wide" style={{ color: "#6B7672" }}>
                        {d.moduleLabel(m.key)} · {m.completed ? d.completed : d.todo}
                      </span>
                      <span className="mt-0.5 block font-heading text-base font-bold" style={{ color: "#1F3B36" }}>
                        {m.title}
                      </span>
                      <span className="mt-1 block text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
                        {m.summary}
                      </span>
                    </span>
                    <span className="hidden shrink-0 self-center text-sm font-semibold sm:block" style={{ color: "#305D55" }}>
                      {m.completed ? d.review : d.open}
                    </span>
                  </Link>
                </li>
              ))}

              <li>
                <div className="flex items-start gap-4 rounded-lg border bg-white p-4 sm:p-5" style={{ borderColor: "#ECE5D9" }}>
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={data.test.status === "passed" ? { background: "#305D55", color: "#FFFFFF" } : { background: "#F5EFE5", color: "#305D55" }}
                  >
                    {data.test.status === "locked" ? <Lock className="h-4 w-4" aria-hidden="true" /> : data.test.status === "passed" ? <Check className="h-4 w-4" aria-hidden="true" /> : <ClipboardCheck className="h-4 w-4" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-heading text-base font-bold" style={{ color: "#1F3B36" }}>
                      {d.testTitle}
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
                      {data.test.status === "locked"
                        ? d.testLocked
                        : data.test.status === "passed"
                          ? d.testPassed(data.test.best_score ?? data.test.total, data.test.total)
                          : d.testAvailable(data.test.pass_score, data.test.total)}
                    </span>
                    {data.test.status === "available" && data.test.best_score !== null && (
                      <span className="mt-1 block text-xs" style={{ color: "#6B7672" }}>
                        {d.bestScore(data.test.best_score, data.test.total)}
                      </span>
                    )}
                  </span>
                  {data.test.status === "available" && (
                    <Link to={paths.test} className="shrink-0 self-center text-sm font-semibold underline" style={{ color: "#305D55" }}>
                      {d.testOpen}
                    </Link>
                  )}
                </div>
              </li>

              <li>
                <div className="flex items-start gap-4 rounded-lg border bg-white p-4 sm:p-5" style={{ borderColor: "#ECE5D9" }}>
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={data.certificate ? { background: "#F28A4B", color: "#1F3B36" } : { background: "#F5EFE5", color: "#305D55" }}
                  >
                    {data.certificate ? <Award className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-heading text-base font-bold" style={{ color: "#1F3B36" }}>
                      {d.certificateTitle}
                    </span>
                    <span className="mt-1 block text-sm" style={{ color: "#4B5B58" }}>
                      {data.certificate ? d.certificateReady(data.certificate.code) : d.certificateLocked}
                    </span>
                  </span>
                  {data.certificate && (
                    <Link to={paths.certificate} className="shrink-0 self-center text-sm font-semibold underline" style={{ color: "#305D55" }}>
                      {d.certificateOpen}
                    </Link>
                  )}
                </div>
              </li>
            </ol>
          </section>
        )}

        {/* 3. Account */}
        <section className="mt-14">
          <h2 className="mb-5 font-heading text-xl font-bold" style={{ color: "#1F3B36" }}>
            {d.account}
          </h2>
          <div className="rounded-lg border bg-white p-5 sm:p-6" style={{ borderColor: "#ECE5D9" }}>
            <p className="text-sm" style={{ color: "#6B7672" }}>
              {t.email}
            </p>
            <p className="mb-6 break-all text-base font-medium" style={{ color: "#1F3B36" }}>
              {student.email}
            </p>
            <ChangePasswordForm lang={lang} onExpired={() => refreshStudent(null)} />
            <div className="mt-8 border-t pt-5" style={{ borderColor: "#ECE5D9" }}>
              <button type="button" onClick={signOut} className={secondaryButton} style={SECONDARY_STYLE}>
                <LogOut className="h-4 w-4" aria-hidden="true" />
                {d.logout}
              </button>
            </div>
          </div>
        </section>

        {/* 4. Help */}
        <section className="mt-10 text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
          <p>
            {d.help} <HelpCenterLink lang={lang} className="font-medium" />.
          </p>
        </section>
      </StudentPage>
    </>
  );
}

function ChangePasswordForm({ lang, onExpired }: { lang: SchoolLang; onExpired: () => void }) {
  const t = STUDENT_TEXT[lang];
  const d = t.dashboard;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < PASSWORD_MIN) return setMessage({ tone: "error", text: t.weakPassword(PASSWORD_MIN) });
    if (next !== confirm) return setMessage({ tone: "error", text: t.passwordsDiffer });
    setBusy(true);
    setMessage(null);
    const res = await changePassword(current, next);
    setBusy(false);
    if (res.ok) {
      setCurrent("");
      setNext("");
      setConfirm("");
      return setMessage({ tone: "success", text: d.passwordChanged });
    }
    const code = "error" in res ? res.error : "error";
    if (code === "unauthorized") return onExpired();
    setMessage({
      tone: "error",
      text:
        code === "wrong_password"
          ? d.wrongPassword
          : code === "weak_password"
            ? t.weakPassword(PASSWORD_MIN)
            : code === "rate_limited"
              ? t.rateLimited
              : t.genericError,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h3 className="font-heading text-base font-bold" style={{ color: "#1F3B36" }}>
        {d.changePassword}
      </h3>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <PasswordField
        id="current-password"
        label={d.currentPassword}
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
        showLabel={t.showPassword}
        hideLabel={t.hidePassword}
      />
      <PasswordField
        id="new-password"
        label={t.newPassword}
        value={next}
        onChange={setNext}
        autoComplete="new-password"
        hint={t.passwordMin(PASSWORD_MIN)}
        showLabel={t.showPassword}
        hideLabel={t.hidePassword}
      />
      <PasswordField
        id="confirm-password"
        label={t.confirmPassword}
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        showLabel={t.showPassword}
        hideLabel={t.hidePassword}
      />
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={busy || !current || !next || !confirm} className={primaryButton} style={PRIMARY_STYLE}>
          {busy ? d.savingPassword : d.savePassword}
        </button>
        <p className="text-xs" style={{ color: "#6B7672" }}>
          {d.forgotCurrent} <HelpCenterLink lang={lang} />.
        </p>
      </div>
    </form>
  );
}
