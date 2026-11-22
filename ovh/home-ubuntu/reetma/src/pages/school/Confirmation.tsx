// Page Mollie sends the student back to after paying. Once the payment is confirmed it is a single
// step: choose a password, then straight into the student space to start the training.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, Eye, EyeOff, MailWarning } from "lucide-react";
import { Seo } from "@/components/Seo";
import { HelpCenterLink } from "@/components/school/HelpCenterLink";
import { schoolFeatures } from "@/config/school";
import { getRegistrationStatus, recordFunnelEvent } from "@/lib/school/api";
import { clearSchoolSession } from "@/lib/school/tracking";
import type { RegistrationStatus } from "@/lib/school/types";
import { SCHOOL_PATHS, useSchoolLang } from "@/lib/school/lang";
import { PASSWORD_MIN, setupAccount } from "@/lib/account";
import { useRefreshStudent } from "@/components/account/RequireStudent";

const TEXT = {
  en: {
    title: "Payment confirmed | L'École by Reetma",
    description: "Create your password to access your L'École training.",
    missing: "We can't find this registration.",
    missingHelp: ["If you paid, open a request in our ", " and we'll sort it out."],
    back: "Back to L'École",
    confirming: "Confirming your payment…",
    slowTitle: "Your payment is still being confirmed.",
    slowHelp: [
      "Refresh this page in a few minutes. If your bank confirmed the payment and this page still shows nothing, open a request in our ",
      ".",
    ],
    expired: "Your seat hold expired.",
    refunded: "This registration was refunded.",
    failed: "Your payment didn't go through.",
    noPayment: "No payment was taken.",
    tryAgain: "Try again",
    heading: (name: string) => `Payment confirmed${name ? `, ${name}` : ""}!`,
    intro: "Last step: choose your password to start your training right away.",
    email: "Your login email",
    password: "Password",
    confirm: "Confirm the password",
    hint: `At least ${PASSWORD_MIN} characters.`,
    show: "Show the password",
    hide: "Hide the password",
    submit: "Access my training",
    busy: "Opening your space…",
    readyTitle: "Your student space is ready.",
    readyBody: "Log in with the password you chose to continue your training.",
    open: "Go to my training",
    errors: {
      weak: `Choose a password of at least ${PASSWORD_MIN} characters.`,
      mismatch: "The two passwords don't match.",
      exists: "An account already exists for this email.",
      notPaid: "This payment is not confirmed yet. Refresh the page in a minute.",
      generic: "We couldn't create your account. Try again in a moment.",
    },
    login: "Log in",
    spam: "Our emails come from no-reply@reetma-agency.com and sometimes land in spam: check it, and mark the address as safe.",
    reference: (ref: string) => `Registration reference: ${ref}`,
    pending: "Your student space opens very soon: use the link in your confirmation email to access it.",
  },
  fr: {
    title: "Paiement confirmé | L'École by Reetma",
    description: "Créez votre mot de passe pour accéder à votre formation L'École.",
    missing: "Nous ne trouvons pas cette inscription.",
    missingHelp: ["Si vous avez payé, ouvrez une demande dans notre ", " et nous réglerons cela."],
    back: "Retour à L'École",
    confirming: "Confirmation de votre paiement…",
    slowTitle: "Votre paiement est encore en cours de confirmation.",
    slowHelp: [
      "Actualisez cette page dans quelques minutes. Si votre banque a confirmé le paiement et que cette page n'affiche toujours rien, ouvrez une demande dans notre ",
      ".",
    ],
    expired: "La réservation de votre place a expiré.",
    refunded: "Cette inscription a été remboursée.",
    failed: "Votre paiement n'a pas abouti.",
    noPayment: "Aucun paiement n'a été prélevé.",
    tryAgain: "Réessayer",
    heading: (name: string) => `Paiement confirmé${name ? `, ${name}` : ""} !`,
    intro: "Dernière étape : choisissez votre mot de passe pour commencer votre formation tout de suite.",
    email: "Votre e-mail de connexion",
    password: "Mot de passe",
    confirm: "Confirmez le mot de passe",
    hint: `Au moins ${PASSWORD_MIN} caractères.`,
    show: "Afficher le mot de passe",
    hide: "Masquer le mot de passe",
    submit: "Accéder à ma formation",
    busy: "Ouverture de votre espace…",
    readyTitle: "Votre espace étudiant est prêt.",
    readyBody: "Connectez-vous avec le mot de passe que vous avez choisi pour continuer votre formation.",
    open: "Aller à ma formation",
    errors: {
      weak: `Choisissez un mot de passe d'au moins ${PASSWORD_MIN} caractères.`,
      mismatch: "Les deux mots de passe ne correspondent pas.",
      exists: "Un compte existe déjà pour cette adresse.",
      notPaid: "Ce paiement n'est pas encore confirmé. Actualisez la page dans une minute.",
      generic: "Nous n'avons pas pu créer votre compte. Réessayez dans un instant.",
    },
    login: "Se connecter",
    spam: "Nos e-mails partent de no-reply@reetma-agency.com et arrivent parfois dans les spams : pensez à vérifier, et marquez l'adresse comme sûre.",
    reference: (ref: string) => `Référence d'inscription : ${ref}`,
    pending: "Votre espace étudiant ouvre très bientôt : utilisez le lien de votre e-mail de confirmation pour y accéder.",
  },
};

const FIELD = "w-full rounded-md border px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[#305D55]/40";

function PasswordSetup({ pid, email }: { pid: string; email: string }) {
  const lang = useSchoolLang();
  const t = TEXT[lang];
  const paths = SCHOOL_PATHS[lang];
  const refreshStudent = useRefreshStudent();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"" | keyof typeof t.errors>("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < PASSWORD_MIN) return setError("weak");
    if (password !== confirm) return setError("mismatch");
    setBusy(true);
    setError("");
    const res = await setupAccount(pid, password);
    if (res.ok) {
      refreshStudent(res.student);
      // Straight into the student space: the training starts right away.
      navigate(paths.account, { replace: true });
      return;
    }
    setBusy(false);
    const code = "error" in res ? res.error : "error";
    setError(code === "weak_password" ? "weak" : code === "exists" ? "exists" : code === "not_paid" ? "notPaid" : "generic");
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="account-email" className="block text-sm font-medium mb-1">
          {t.email}
        </label>
        <input
          id="account-email"
          type="email"
          autoComplete="username"
          value={email}
          readOnly
          className={FIELD}
          style={{ borderColor: "#DDD5C7", background: "#FBF7F0", color: "#4B5B58" }}
        />
      </div>
      <div>
        <label htmlFor="account-password" className="block text-sm font-medium mb-1">
          {t.password}
        </label>
        <div className="relative">
          <input
            id="account-password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${FIELD} pr-10`}
            style={{ borderColor: error === "weak" ? "#FCA5A5" : "#DDD5C7" }}
            aria-describedby="account-password-hint"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? t.hide : t.show}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
            style={{ color: "#9AA49F" }}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p id="account-password-hint" className="mt-1 text-xs" style={{ color: "#6B7672" }}>
          {t.hint}
        </p>
      </div>
      <div>
        <label htmlFor="account-confirm" className="block text-sm font-medium mb-1">
          {t.confirm}
        </label>
        <input
          id="account-confirm"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={FIELD}
          style={{ borderColor: error === "mismatch" ? "#FCA5A5" : "#DDD5C7" }}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm" style={{ color: "#B91C1C" }}>
          {t.errors[error]}{" "}
          {error === "exists" && (
            <Link to={paths.login} className="underline font-semibold">
              {t.login}
            </Link>
          )}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="w-full h-12 text-base font-semibold text-white disabled:opacity-60"
        style={{ background: "#305D55" }}
      >
        {busy ? t.busy : t.submit}
      </button>
    </form>
  );
}

export default function SchoolConfirmation() {
  const lang = useSchoolLang();
  const t = TEXT[lang];
  const paths = SCHOOL_PATHS[lang];
  const [params] = useSearchParams();
  const sessionId = params.get("pid") ?? params.get("session_id") ?? "";
  const [data, setData] = useState<RegistrationStatus | null>(null);
  const [phase, setPhase] = useState<"loading" | "slow" | "done" | "missing">(
    sessionId ? "loading" : "missing",
  );
  const recorded = useRef(false);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let attempts = 0;

    async function poll() {
      const res = await getRegistrationStatus(sessionId);
      if (cancelled) return;
      setData(res);

      if (res.status === "not_found") {
        setPhase("missing");
        return;
      }
      if (res.status === "pending_payment" && attempts < 10) {
        attempts += 1;
        window.setTimeout(poll, 2000);
        return;
      }
      setPhase(res.status === "pending_payment" ? "slow" : "done");
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (data?.status === "paid" && !recorded.current) {
      recorded.current = true;
      clearSchoolSession();
      recordFunnelEvent("registration_paid");
    }
  }, [data?.status]);

  const seo = <Seo title={t.title} description={t.description} path={paths.confirmation} lang={lang} noindex />;
  const wrapper = "pt-32 pb-24 px-6 lg:px-12";
  const muted = { color: "#4B5B58" };

  if (phase === "missing") {
    return (
      <>
        {seo}
        <div className={wrapper}>
          <div className="max-w-md mx-auto">
            <h1 className="font-heading text-2xl font-bold mb-4" style={{ color: "#1F3B36" }}>
              {t.missing}
            </h1>
            <p className="text-base mb-6" style={muted}>
              {t.missingHelp[0]}
              <HelpCenterLink />
              {t.missingHelp[1]}
            </p>
            <Link to={paths.home} className="underline" style={{ color: "#305D55" }}>
              {t.back}
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (phase === "loading") {
    return (
      <>
        {seo}
        <div className={wrapper}>
          <div className="max-w-md mx-auto space-y-4">
            <p className="text-base" style={muted}>
              {t.confirming}
            </p>
            <div className="h-6 w-2/3 animate-pulse rounded" style={{ background: "#ECE5D9" }} />
            <div className="h-48 animate-pulse rounded" style={{ background: "#F5EFE5" }} />
          </div>
        </div>
      </>
    );
  }

  if (phase === "slow") {
    return (
      <>
        {seo}
        <div className={wrapper}>
          <div className="max-w-md mx-auto">
            <h1 className="font-heading text-2xl font-bold mb-4" style={{ color: "#1F3B36" }}>
              {t.slowTitle}
            </h1>
            <p className="text-base" style={muted}>
              {t.slowHelp[0]}
              <HelpCenterLink />
              {t.slowHelp[1]}
            </p>
          </div>
        </div>
      </>
    );
  }

  if (data && data.status !== "paid") {
    const noPaymentTaken = data.status === "expired" || data.status === "payment_failed";
    return (
      <>
        {seo}
        <div className={wrapper}>
          <div className="max-w-md mx-auto space-y-5">
            <h1 className="font-heading text-2xl font-bold" style={{ color: "#1F3B36" }}>
              {data.status === "expired" ? t.expired : data.status === "refunded" ? t.refunded : t.failed}
            </h1>
            {noPaymentTaken && (
              <p className="text-base" style={muted}>
                {t.noPayment}
              </p>
            )}
            <Link
              to={`${paths.home}#register`}
              className="inline-block px-6 py-3 text-sm font-semibold text-white"
              style={{ background: "#305D55" }}
            >
              {t.tryAgain}
            </Link>
          </div>
        </div>
      </>
    );
  }

  const ref = data?.public_ref ?? "";
  return (
    <>
      {seo}
      <div className={wrapper}>
        <div className="max-w-md mx-auto">
          <span
            className="mb-6 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: "#305D55" }}
          >
            <Check className="h-6 w-6 text-white" />
          </span>
          <h1 className="font-heading text-3xl font-bold mb-2" style={{ color: "#1F3B36" }}>
            {t.heading(data?.first_name ?? "")}
          </h1>

          {!schoolFeatures.studentSpace ? (
            <p className="text-base mb-8" style={muted}>
              {t.pending}
            </p>
          ) : data?.has_account ? (
            <div className="mt-6 mb-8 space-y-4">
              <p className="font-heading text-lg font-bold" style={{ color: "#1F3B36" }}>
                {t.readyTitle}
              </p>
              <p className="text-base" style={muted}>
                {t.readyBody}
              </p>
              <Link
                to={paths.account}
                className="inline-flex h-12 items-center px-6 text-base font-semibold text-white"
                style={{ background: "#305D55" }}
              >
                {t.open}
              </Link>
            </div>
          ) : (
            <>
              <p className="text-base mb-8" style={muted}>
                {t.intro}
              </p>
              <PasswordSetup pid={sessionId} email={data?.email ?? ""} />
            </>
          )}

          <div
            role="note"
            className="mt-6 flex gap-3 p-4"
            style={{ background: "#FDF1E8", border: "1px solid #F5C9A9", color: "#7A3E12" }}
          >
            <MailWarning className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm leading-relaxed">{t.spam}</p>
          </div>

          {ref && (
            <p className="mt-6 text-xs" style={{ color: "#9AA49F" }}>
              {t.reference(ref)}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
