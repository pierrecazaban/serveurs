import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Seo } from "@/components/Seo";
import { useRefreshStudent, useStudent } from "@/components/account/RequireStudent";
import { STUDENT_TEXT } from "@/components/account/studentText";
import { Eyebrow, Notice, PasswordField, StudentPage } from "@/components/account/StudentUi";
import { PRIMARY_STYLE, inputClass, primaryButton } from "@/components/account/studentStyles";
import { login } from "@/lib/account";
import { SCHOOL_PATHS, useSchoolLang } from "@/lib/school/lang";

/** Only the student space is a valid destination after login. */
function safeRedirect(value: string | null): string | null {
  if (!value) return null;
  const allowed = [SCHOOL_PATHS.en.account, SCHOOL_PATHS.fr.account];
  return allowed.some((p) => value === p || value.startsWith(`${p}/`)) ? value : null;
}

export default function StudentLogin() {
  const lang = useSchoolLang();
  const t = STUDENT_TEXT[lang];
  const paths = SCHOOL_PATHS[lang];
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get("redirect"));
  const navigate = useNavigate();
  const { student } = useStudent();
  const refreshStudent = useRefreshStudent();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (student) return <Navigate to={redirect ?? SCHOOL_PATHS[student.lang].account} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError("");
    const res = await login(email.trim(), password);
    setBusy(false);
    if (res.ok) {
      refreshStudent(res.student);
      navigate(redirect ?? SCHOOL_PATHS[res.student.lang].account, { replace: true });
      return;
    }
    const code = "error" in res ? res.error : "error";
    setError(code === "invalid" ? t.login.invalid : code === "rate_limited" ? t.rateLimited : t.genericError);
  }

  return (
    <>
      <Seo
        title={t.login.seoTitle}
        description={t.login.seoDescription}
        path={paths.login}
        lang={lang}
        alternates={{ en: SCHOOL_PATHS.en.login, fr: SCHOOL_PATHS.fr.login }}
        noindex
      />
      <StudentPage>
        <div className="mx-auto max-w-md">
          <Eyebrow>{t.brand}</Eyebrow>
          <h1 className="mb-2 font-heading text-2xl font-bold sm:text-3xl" style={{ color: "#1F3B36" }}>
            {t.login.title}
          </h1>
          <p className="mb-8 text-base" style={{ color: "#4B5B58" }}>
            {t.login.intro}
          </p>

          <form onSubmit={submit} className="space-y-5" noValidate>
            {error && <Notice tone="error">{error}</Notice>}
            <div>
              <label htmlFor="login-email" className="mb-1 block text-sm font-medium" style={{ color: "#1F3B36" }}>
                {t.email}
              </label>
              <input
                id="login-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                className={inputClass}
                style={{ borderColor: "#DDD5C7", color: "#1F3B36" }}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <PasswordField
              id="login-password"
              label={t.password}
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              showLabel={t.showPassword}
              hideLabel={t.hidePassword}
            />
            <div className="flex flex-wrap items-center justify-between gap-4">
              <button
                type="submit"
                disabled={busy || !email.trim() || !password}
                className={primaryButton}
                style={PRIMARY_STYLE}
              >
                {busy ? t.login.submitting : t.login.submit}
              </button>
              <Link to={paths.help} className="text-sm font-medium underline" style={{ color: "#305D55" }}>
                {t.login.forgot}
              </Link>
            </div>
          </form>

          <p className="mt-6 text-xs leading-relaxed" style={{ color: "#6B7672" }}>
            {t.spamNote}
          </p>

          <div className="mt-10 rounded-md p-5" style={{ background: "#FBF6EE", border: "1px solid #ECE5D9" }}>
            <p className="mb-1 text-sm font-semibold" style={{ color: "#1F3B36" }}>
              {t.login.noAccountTitle}
            </p>
            <p className="text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
              {t.login.noAccount}
            </p>
            <p className="mt-3 text-sm" style={{ color: "#4B5B58" }}>
              {t.login.notRegistered}{" "}
              <Link to={paths.home} className="font-medium underline" style={{ color: "#305D55" }}>
                {t.login.discover}
              </Link>
            </p>
          </div>
        </div>
      </StudentPage>
    </>
  );
}
