import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Seo } from "@/components/Seo";
import { useRefreshStudent } from "@/components/account/RequireStudent";
import { STUDENT_TEXT } from "@/components/account/studentText";
import { Eyebrow, Notice, PasswordField, StudentPage } from "@/components/account/StudentUi";
import { PRIMARY_STYLE, primaryButton } from "@/components/account/studentStyles";
import { PASSWORD_MIN, resetPassword } from "@/lib/account";
import { SCHOOL_PATHS, useSchoolLang } from "@/lib/school/lang";

export default function ResetPassword() {
  const lang = useSchoolLang();
  const t = STUDENT_TEXT[lang];
  const paths = SCHOOL_PATHS[lang];
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const refreshStudent = useRefreshStudent();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState(!token);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < PASSWORD_MIN) return setError(t.weakPassword(PASSWORD_MIN));
    if (password !== confirm) return setError(t.passwordsDiffer);
    setBusy(true);
    setError("");
    const res = await resetPassword(token, password);
    setBusy(false);
    if (res.ok) {
      refreshStudent(res.student);
      navigate(SCHOOL_PATHS[res.student.lang].account, { replace: true });
      return;
    }
    const code = "error" in res ? res.error : "error";
    if (code === "invalid_token") return setInvalid(true);
    setError(
      code === "weak_password"
        ? t.weakPassword(PASSWORD_MIN)
        : code === "rate_limited"
          ? t.rateLimited
          : t.genericError,
    );
  }

  return (
    <>
      <Seo
        title={t.reset.seoTitle}
        description={t.reset.intro}
        path={paths.reset}
        lang={lang}
        alternates={{ en: SCHOOL_PATHS.en.reset, fr: SCHOOL_PATHS.fr.reset }}
        noindex
      />
      <StudentPage>
        <div className="mx-auto max-w-md">
          <Eyebrow>{t.brand}</Eyebrow>
          {invalid ? (
            <>
              <h1 className="mb-4 font-heading text-2xl font-bold sm:text-3xl" style={{ color: "#1F3B36" }}>
                {t.reset.invalidTitle}
              </h1>
              <p className="text-base leading-relaxed" style={{ color: "#4B5B58" }}>
                {t.reset.invalidBody}{" "}
                <Link to={paths.help} className="font-medium underline" style={{ color: "#305D55" }}>
                  {t.reset.helpLink}
                </Link>
                .
              </p>
              <p className="mt-6 text-xs leading-relaxed" style={{ color: "#6B7672" }}>
                {t.spamNote}
              </p>
            </>
          ) : (
            <>
              <h1 className="mb-2 font-heading text-2xl font-bold sm:text-3xl" style={{ color: "#1F3B36" }}>
                {t.reset.title}
              </h1>
              <p className="mb-8 text-base" style={{ color: "#4B5B58" }}>
                {t.reset.intro}
              </p>
              <form onSubmit={submit} className="space-y-5" noValidate>
                {error && <Notice tone="error">{error}</Notice>}
                <PasswordField
                  id="reset-password"
                  label={t.newPassword}
                  value={password}
                  onChange={setPassword}
                  autoComplete="new-password"
                  hint={t.passwordMin(PASSWORD_MIN)}
                  showLabel={t.showPassword}
                  hideLabel={t.hidePassword}
                />
                <PasswordField
                  id="reset-confirm"
                  label={t.confirmPassword}
                  value={confirm}
                  onChange={setConfirm}
                  autoComplete="new-password"
                  showLabel={t.showPassword}
                  hideLabel={t.hidePassword}
                />
                <button type="submit" disabled={busy || !password || !confirm} className={primaryButton} style={PRIMARY_STYLE}>
                  {busy ? t.reset.submitting : t.reset.submit}
                </button>
              </form>
            </>
          )}
        </div>
      </StudentPage>
    </>
  );
}
