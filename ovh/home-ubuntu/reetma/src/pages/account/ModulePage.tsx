import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Seo } from "@/components/Seo";
import { RequireStudent, useRefreshStudent } from "@/components/account/RequireStudent";
import { STUDENT_TEXT } from "@/components/account/studentText";
import { BackLink, Eyebrow, ModuleBody, Notice, StudentPage } from "@/components/account/StudentUi";
import { PRIMARY_STYLE, SECONDARY_STYLE, primaryButton, secondaryButton } from "@/components/account/studentStyles";
import { StudentApiError, completeModule, fetchModule, formatDate } from "@/lib/student";
import { SCHOOL_PATHS, useSchoolLang, type SchoolLang } from "@/lib/school/lang";

export default function ModulePage() {
  const lang = useSchoolLang();
  const { key = "" } = useParams();
  return <RequireStudent>{() => <ModuleView moduleKey={key} lang={lang} />}</RequireStudent>;
}

function ModuleView({ moduleKey, lang }: { moduleKey: string; lang: SchoolLang }) {
  const t = STUDENT_TEXT[lang];
  const m = t.module;
  const paths = SCHOOL_PATHS[lang];
  const queryClient = useQueryClient();
  const refreshStudent = useRefreshStudent();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["student-module", lang, moduleKey],
    queryFn: () => fetchModule(lang, moduleKey),
    retry: false,
  });

  useEffect(() => {
    if (query.error instanceof StudentApiError && query.error.status === 401) refreshStudent(null);
  }, [query.error, refreshStudent]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [moduleKey]);

  async function markDone() {
    setSaving(true);
    setError("");
    try {
      await completeModule(lang, moduleKey);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["student-module", lang, moduleKey] }),
        queryClient.invalidateQueries({ queryKey: ["student-course"] }),
      ]);
    } catch (err) {
      if (err instanceof StudentApiError && err.status === 401) return refreshStudent(null);
      setError(t.genericError);
    } finally {
      setSaving(false);
    }
  }

  const notFound = query.error instanceof StudentApiError && query.error.status === 404;
  const data = query.data;

  return (
    <>
      <Seo
        title={data ? m.seoTitle(data.key, data.title) : t.brand}
        description={data?.summary ?? t.brand}
        path={`${paths.module}/${moduleKey}`}
        lang={lang}
        alternates={{ en: `${SCHOOL_PATHS.en.module}/${moduleKey}`, fr: `${SCHOOL_PATHS.fr.module}/${moduleKey}` }}
        noindex
      />
      <StudentPage>
        <BackLink to={paths.account}>{t.backToSpace}</BackLink>

        {query.isLoading && (
          <div className="space-y-4">
            <div className="h-8 w-2/3 animate-pulse rounded" style={{ background: "#ECE5D9" }} />
            <div className="h-40 animate-pulse rounded" style={{ background: "#F5EFE5" }} />
          </div>
        )}
        {notFound && <p className="text-base" style={{ color: "#4B5B58" }}>{m.notFound}</p>}
        {query.isError && !notFound && !(query.error instanceof StudentApiError && query.error.status === 401) && (
          <Notice tone="error">{t.genericError}</Notice>
        )}

        {data && (
          <article>
            <Eyebrow>Module {data.key} / 3</Eyebrow>
            <h1 className="font-heading text-2xl font-bold leading-tight sm:text-3xl" style={{ color: "#1F3B36" }}>
              {data.title}
            </h1>
            <p className="mt-3 text-lg leading-relaxed" style={{ color: "#4B5B58" }}>
              {data.summary}
            </p>

            <div className="mt-8 rounded-lg p-5 sm:p-6" style={{ background: "#FBF6EE", border: "1px solid #ECE5D9" }}>
              <h2 className="mb-3 font-heading text-base font-bold" style={{ color: "#1F3B36" }}>
                {m.objectives}
              </h2>
              <ul className="space-y-2.5">
                {data.objectives.map((o) => (
                  <li key={o} className="flex gap-3 text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
                    <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#305D55" }} aria-hidden="true" />
                    {o}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6">
              <ModuleBody markdown={data.body} />
            </div>

            <div className="mt-10 border-t pt-6" style={{ borderColor: "#ECE5D9" }}>
              {error && (
                <div className="mb-4">
                  <Notice tone="error">{error}</Notice>
                </div>
              )}
              {data.completed ? (
                <p className="mb-6 inline-flex items-center gap-2 text-sm font-semibold" style={{ color: "#305D55" }}>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  {data.completed_at ? m.completedOn(formatDate(data.completed_at, lang)) : t.dashboard.completed}
                </p>
              ) : (
                <button type="button" onClick={markDone} disabled={saving} className={`${primaryButton} mb-6 w-full sm:w-auto`} style={PRIMARY_STYLE}>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  {saving ? m.marking : m.markDone}
                </button>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                {data.prev_key ? (
                  <Link to={`${paths.module}/${data.prev_key}`} className={secondaryButton} style={SECONDARY_STYLE}>
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    {m.previous(data.prev_key)}
                  </Link>
                ) : (
                  <span />
                )}
                {data.next_key ? (
                  <Link
                    to={`${paths.module}/${data.next_key}`}
                    className={data.completed ? primaryButton : secondaryButton}
                    style={data.completed ? PRIMARY_STYLE : SECONDARY_STYLE}
                  >
                    {m.next(data.next_key)}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                ) : (
                  <Link
                    to={paths.test}
                    className={data.completed ? primaryButton : secondaryButton}
                    style={data.completed ? PRIMARY_STYLE : SECONDARY_STYLE}
                  >
                    {m.toTest}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                )}
              </div>
            </div>
          </article>
        )}
      </StudentPage>
    </>
  );
}
