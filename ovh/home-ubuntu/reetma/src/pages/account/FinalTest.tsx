import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Award } from "lucide-react";
import { Seo } from "@/components/Seo";
import { RequireStudent, useRefreshStudent } from "@/components/account/RequireStudent";
import { STUDENT_TEXT } from "@/components/account/studentText";
import { BackLink, Eyebrow, Notice, StudentPage } from "@/components/account/StudentUi";
import { PRIMARY_STYLE, primaryButton } from "@/components/account/studentStyles";
import { StudentApiError, fetchTest, submitTest, type SubmitResult } from "@/lib/student";
import { SCHOOL_PATHS, useSchoolLang, type SchoolLang } from "@/lib/school/lang";

export default function FinalTest() {
  const lang = useSchoolLang();
  return <RequireStudent>{() => <TestView lang={lang} />}</RequireStudent>;
}

function TestView({ lang }: { lang: SchoolLang }) {
  const t = STUDENT_TEXT[lang];
  const x = t.test;
  const paths = SCHOOL_PATHS[lang];
  const queryClient = useQueryClient();
  const refreshStudent = useRefreshStudent();
  const query = useQuery({ queryKey: ["student-test", lang], queryFn: () => fetchTest(lang), retry: false, staleTime: 0 });
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [outOfAttempts, setOutOfAttempts] = useState(false);

  const status = query.error instanceof StudentApiError ? query.error.status : 0;
  useEffect(() => {
    if (status === 401) refreshStudent(null);
  }, [status, refreshStudent]);

  const data = query.data;
  const questions = data?.questions ?? [];
  const missing = questions.filter((q) => answers[q.id] === undefined).length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (missing > 0) return setError(x.answerAll(missing));
    setBusy(true);
    setError("");
    try {
      const res = await submitTest(lang, answers);
      setResult(res);
      window.scrollTo({ top: 0, behavior: "smooth" });
      await queryClient.invalidateQueries({ queryKey: ["student-course"] });
    } catch (err) {
      if (err instanceof StudentApiError) {
        if (err.status === 401) return refreshStudent(null);
        if (err.status === 429) return setOutOfAttempts(true);
        if (err.status === 409) return void query.refetch();
      }
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    setResult(null);
    setAnswers({});
    window.scrollTo({ top: 0, behavior: "smooth" });
    void query.refetch();
  }

  const certificateLink = (
    <Link to={paths.certificate} className={`${primaryButton} w-full sm:w-auto`} style={PRIMARY_STYLE}>
      <Award className="h-4 w-4" aria-hidden="true" />
      {x.viewCertificate}
    </Link>
  );

  return (
    <>
      <Seo title={x.seoTitle} description={x.seoTitle} path={paths.test} lang={lang} alternates={{ en: SCHOOL_PATHS.en.test, fr: SCHOOL_PATHS.fr.test }} noindex />
      <StudentPage>
        <BackLink to={paths.account}>{t.backToSpace}</BackLink>
        <Eyebrow>{t.brand}</Eyebrow>
        <h1 className="mb-3 font-heading text-2xl font-bold sm:text-3xl" style={{ color: "#1F3B36" }}>
          {x.title}
        </h1>

        {query.isLoading && <div className="mt-6 h-48 animate-pulse rounded" style={{ background: "#F5EFE5" }} />}

        {status === 403 && (
          <div className="mt-4 space-y-5">
            <p className="text-base" style={{ color: "#4B5B58" }}>{x.locked}</p>
            <Link to={paths.account} className={primaryButton} style={PRIMARY_STYLE}>
              {t.backToSpace}
            </Link>
          </div>
        )}
        {query.isError && status !== 403 && status !== 401 && <Notice tone="error">{t.genericError}</Notice>}

        {/* Result of the attempt just sent */}
        {result && (
          <section
            className="mt-6 rounded-xl p-6 sm:p-8"
            style={result.passed ? { background: "#E3EDE7", border: "1px solid #C9DCD1" } : { background: "#FBF6EE", border: "1px solid #ECE5D9" }}
            role="status"
          >
            <h2 className="font-heading text-xl font-bold" style={{ color: "#1F3B36" }}>
              {result.passed ? x.passedTitle : x.failedTitle}
            </h2>
            <p className="mt-2 text-base" style={{ color: "#4B5B58" }}>
              {x.score(result.score, result.total, result.percent)}
            </p>
            {result.passed ? (
              <div className="mt-6">{certificateLink}</div>
            ) : (
              <>
                <p className="mt-1 text-base" style={{ color: "#4B5B58" }}>
                  {x.failedBody(result.pass_score, result.total)}
                </p>
                {result.attempts_left > 0 ? (
                  <>
                    <p className="mt-3 text-sm" style={{ color: "#6B7672" }}>
                      {x.attemptsLeft(result.attempts_left, data?.test.max_attempts ?? 5)}
                    </p>
                    <button type="button" onClick={retry} className={`${primaryButton} mt-6`} style={PRIMARY_STYLE}>
                      {x.retry}
                    </button>
                  </>
                ) : (
                  <p className="mt-3 text-sm font-medium" style={{ color: "#B4561F" }}>
                    {x.noAttempts}
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {/* Already passed (e.g. coming back to this page) */}
        {!result && data?.test.status === "passed" && (
          <div className="mt-4 space-y-6">
            <p className="text-base" style={{ color: "#4B5B58" }}>
              {x.alreadyPassed(data.test.best_score ?? data.test.total, data.test.total)}
            </p>
            {certificateLink}
          </div>
        )}

        {/* No attempt left for now */}
        {!result && data?.test.status === "available" && (outOfAttempts || data.test.attempts_left === 0) && (
          <div className="mt-4">
            <Notice tone="info">{x.noAttempts}</Notice>
          </div>
        )}

        {/* The questions */}
        {!result && data?.test.status === "available" && !outOfAttempts && data.test.attempts_left > 0 && (
          <>
            <p className="text-base leading-relaxed" style={{ color: "#4B5B58" }}>
              {x.intro(data.test.pass_score, data.test.total, data.test.pass_percent)}
            </p>
            <p className="mt-1 text-sm" style={{ color: "#6B7672" }}>
              {x.attemptsLeft(data.test.attempts_left, data.test.max_attempts)}
            </p>

            <form onSubmit={submit} className="mt-8 space-y-6" noValidate>
              {questions.map((q, i) => (
                <fieldset key={q.id} className="rounded-lg border bg-white p-5 sm:p-6" style={{ borderColor: "#ECE5D9" }}>
                  <legend className="sr-only">{x.question(i + 1, questions.length)}</legend>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#6B7672" }}>
                    {x.question(i + 1, questions.length)}
                  </p>
                  <p className="mt-1 mb-4 font-heading text-base font-bold leading-snug" style={{ color: "#1F3B36" }}>
                    {q.prompt}
                  </p>
                  <div className="space-y-2">
                    {q.options.map((option, j) => {
                      const checked = answers[q.id] === j;
                      return (
                        <label
                          key={j}
                          className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm leading-relaxed transition-colors"
                          style={{
                            borderColor: checked ? "#305D55" : "#ECE5D9",
                            background: checked ? "#F1F6F3" : "#FFFFFF",
                            color: "#1F3B36",
                          }}
                        >
                          <input
                            type="radio"
                            name={q.id}
                            className="mt-1 h-4 w-4 shrink-0 accent-[#305D55]"
                            checked={checked}
                            onChange={() => {
                              setAnswers((a) => ({ ...a, [q.id]: j }));
                              setError("");
                            }}
                          />
                          <span>{option}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}

              {error && <Notice tone="error">{error}</Notice>}
              <button type="submit" disabled={busy} className={`${primaryButton} w-full sm:w-auto`} style={PRIMARY_STYLE}>
                {busy ? x.submitting : x.submit}
                {!busy && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
              </button>
            </form>
          </>
        )}
      </StudentPage>
    </>
  );
}
