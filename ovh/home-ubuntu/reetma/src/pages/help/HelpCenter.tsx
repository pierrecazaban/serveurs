import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { CalendarClock, CircleCheck, KeyRound, MailX, ReceiptText } from "lucide-react";
import { Seo } from "@/components/Seo";
import { schoolText } from "@/config/school";
import { SCHOOL_PATHS, alternateSchoolPath, useSchoolLang, type SchoolLang } from "@/lib/school/lang";
import { requestPasswordReset } from "@/lib/account";
import { useStudent } from "@/components/account/RequireStudent";
import {
  CATEGORY_LABELS,
  REQUEST_CATEGORIES,
  createTicket,
  isRequestCategory,
  type RequestCategory,
  type TicketFieldError,
  type TicketInput,
} from "@/components/help/helpApi";

const TEXT = {
  en: {
    seoTitle: "Help center | Reetma",
    seoDescription:
      "Forgot your password, refunds or any other question: send us a request and we answer by email.",
    title: "Help center",
    intro:
      "A question about L'École, your registration or your account? The answers to the two most common requests are right below. For anything else, send us a request.",
    switchLabel: "Français",
    password: {
      title: "Forgot your password?",
      body: "Enter the email address you registered with: we'll send you a link to choose a new password.",
      email: "Email address",
      submit: "Send me the link",
      sending: "Sending…",
      sent: "If an account exists for this address, we just sent a link that works for 1 hour. It may land in your spam folder: check it.",
      login: "Log in",
      changeBefore: "You can also change your password at any time from your ",
      changeLink: "student space",
      changeAfter: ".",
      errors: {
        invalid_email: "Enter a valid email address.",
        rate_limited: "Too many requests. Wait a few minutes and try again.",
        error: "Something went wrong. Try again in a moment.",
      },
    },
    refund: {
      title: "Refunds",
      lead: "L'École is not refundable.",
      link: "Read the refund policy",
    },
    noReply:
      "Our emails are sent from a no-reply address: nobody reads that inbox. Every question goes through this help center, and we answer you by email.",
    form: {
      title: "Send a request",
      name: "Full name",
      email: "Email address",
      emailHelp: "Use the address you registered with, if you have registered.",
      category: "Topic",
      choose: "Choose…",
      reference: "Registration reference (optional)",
      referenceHelp: "It starts with ECO- and is on your confirmation page and in your confirmation email.",
      subject: "Subject",
      message: "Your message",
      submit: "Send my request",
      sending: "Sending…",
    },
    fieldErrors: {
      name: "Enter your name.",
      email: "Enter a valid email address.",
      category: "Choose a topic.",
      reference: "This reference doesn't look right (for example ECO-1A2B3C4D).",
      subject: "Enter a subject (3 characters minimum).",
      message: "Your message needs at least 10 characters.",
      messageTooLong: "Your message is too long (5,000 characters maximum).",
    },
    summaryError: "Check the fields marked below.",
    rateLimited: "Too many requests sent. Wait a few minutes and try again.",
    sendError: "Your request could not be sent. Try again in a moment.",
    success: {
      title: (n: string) => `Request ${n} sent.`,
      body: "We'll answer you by email from a no-reply address: check your spam folder.",
      keep: "Keep this number: it helps if you contact us again.",
      another: "Send another request",
    },
    bookCall: {
      body: "To talk about a business project, book a 30-minute call directly in our calendar.",
      button: "Book a call",
    },
  },
  fr: {
    seoTitle: "Centre d'aide | Reetma",
    seoDescription:
      "Mot de passe oublié, remboursement ou toute autre question : envoyez-nous une demande, nous vous répondons par e-mail.",
    title: "Centre d'aide",
    intro:
      "Une question sur L'École, votre inscription ou votre compte ? Les réponses aux deux demandes les plus fréquentes sont juste en dessous. Pour tout le reste, envoyez-nous une demande.",
    switchLabel: "English",
    password: {
      title: "Mot de passe oublié ?",
      body: "Indiquez l'adresse e-mail de votre inscription : nous vous envoyons un lien pour choisir un nouveau mot de passe.",
      email: "Adresse e-mail",
      submit: "Recevoir le lien",
      sending: "Envoi…",
      sent: "Si un compte existe pour cette adresse, nous venons d'envoyer un lien valable 1 heure. Il peut arriver dans les spams : pensez à vérifier.",
      login: "Se connecter",
      changeBefore: "Vous pouvez aussi changer votre mot de passe à tout moment depuis votre ",
      changeLink: "espace étudiant",
      changeAfter: ".",
      errors: {
        invalid_email: "Indiquez une adresse e-mail valide.",
        rate_limited: "Trop de demandes. Patientez quelques minutes puis réessayez.",
        error: "Une erreur est survenue. Réessayez dans un instant.",
      },
    },
    refund: {
      title: "Remboursement",
      lead: "L'École n'est pas remboursable.",
      link: "Lire la politique de remboursement",
    },
    noReply:
      "Nos e-mails partent d'une adresse no-reply : personne ne lit cette boîte. Toutes les questions passent par ce centre d'aide, et nous vous répondons par e-mail.",
    form: {
      title: "Envoyer une demande",
      name: "Nom et prénom",
      email: "Adresse e-mail",
      emailHelp: "Celle de votre inscription, si vous êtes inscrit(e).",
      category: "Sujet",
      choose: "Choisir…",
      reference: "Référence d'inscription (facultatif)",
      referenceHelp: "Elle commence par ECO- et figure sur votre page de confirmation et dans l'e-mail de confirmation.",
      subject: "Objet",
      message: "Votre message",
      submit: "Envoyer ma demande",
      sending: "Envoi…",
    },
    fieldErrors: {
      name: "Indiquez votre nom.",
      email: "Indiquez une adresse e-mail valide.",
      category: "Choisissez un sujet.",
      reference: "Cette référence ne semble pas valide (par exemple ECO-1A2B3C4D).",
      subject: "Indiquez un objet (3 caractères minimum).",
      message: "Votre message doit faire au moins 10 caractères.",
      messageTooLong: "Votre message est trop long (5 000 caractères maximum).",
    },
    summaryError: "Vérifiez les champs signalés ci-dessous.",
    rateLimited: "Trop de demandes envoyées. Patientez quelques minutes puis réessayez.",
    sendError: "Votre demande n'a pas pu être envoyée. Réessayez dans un instant.",
    success: {
      title: (n: string) => `Demande ${n} envoyée.`,
      body: "Nous vous répondrons par e-mail depuis une adresse no-reply : pensez à vérifier vos spams.",
      keep: "Gardez ce numéro : il vous sera utile si vous nous recontactez.",
      another: "Envoyer une autre demande",
    },
    bookCall: {
      body: "Pour parler d'un projet d'entreprise, réservez directement un appel de 30 minutes dans notre calendrier.",
      button: "Prendre rendez-vous",
    },
  },
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const inputBase =
  "w-full rounded-md border bg-white px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[#305D55]/40";
const border = (error?: unknown) => ({ borderColor: error ? "#FCA5A5" : "#DDD5C7" });

type FormState = { name: string; email: string; category: RequestCategory | ""; reference: string; subject: string; message: string };
type Field = keyof FormState;

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 text-sm" style={{ color: "#B91C1C" }}>
      {message}
    </p>
  );
}

function ForgotPassword({ lang }: { lang: SchoolLang }) {
  const t = TEXT[lang].password;
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!EMAIL_RE.test(email.trim())) {
      setError(t.errors.invalid_email);
      return;
    }
    setState("sending");
    const res = await requestPasswordReset(email.trim().toLowerCase());
    if (res.ok) {
      setState("sent");
      return;
    }
    setState("idle");
    const code = "error" in res ? res.error : "error";
    setError(code === "invalid_email" ? t.errors.invalid_email : code === "rate_limited" ? t.errors.rate_limited : t.errors.error);
  }

  return (
    <article id="password" className="scroll-mt-28 border bg-white p-6 sm:p-7" style={{ borderColor: "#ECE5D9" }}>
      <span className="mb-4 flex size-10 items-center justify-center rounded-full" style={{ background: "#E3EDE7", color: "#305D55" }}>
        <KeyRound className="size-5" aria-hidden="true" />
      </span>
      <h2 className="font-heading text-xl font-bold mb-2" style={{ color: "#1F3B36" }}>
        {t.title}
      </h2>
      {state === "sent" ? (
        <p role="status" className="text-sm leading-relaxed mb-4" style={{ color: "#305D55" }}>
          {t.sent}
        </p>
      ) : (
        <>
          <p className="text-sm leading-relaxed mb-4" style={{ color: "#4B5B58" }}>
            {t.body}
          </p>
          <form onSubmit={submit} noValidate className="space-y-3">
            <div>
              <label htmlFor="forgot-email" className="block text-sm font-medium mb-1">
                {t.email}
              </label>
              <input
                id="forgot-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                className={inputBase}
                style={border(error)}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <FieldError message={error} />
            </div>
            <button
              type="submit"
              disabled={state === "sending"}
              className="px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "#305D55" }}
            >
              {state === "sending" ? t.sending : t.submit}
            </button>
          </form>
        </>
      )}
      <div className="mt-5 space-y-2 border-t pt-4 text-sm" style={{ borderColor: "#ECE5D9", color: "#4B5B58" }}>
        <p>
          <Link to={SCHOOL_PATHS[lang].login} className="font-semibold underline" style={{ color: "#305D55" }}>
            {t.login}
          </Link>
        </p>
        <p>
          {t.changeBefore}
          <Link to={SCHOOL_PATHS[lang].account} className="underline" style={{ color: "#305D55" }}>
            {t.changeLink}
          </Link>
          {t.changeAfter}
        </p>
      </div>
    </article>
  );
}

function RefundBlock({ lang }: { lang: SchoolLang }) {
  const t = TEXT[lang].refund;
  return (
    <article id="refund" className="scroll-mt-28 border bg-white p-6 sm:p-7" style={{ borderColor: "#ECE5D9" }}>
      <span className="mb-4 flex size-10 items-center justify-center rounded-full" style={{ background: "#FDEBDD", color: "#B4561F" }}>
        <ReceiptText className="size-5" aria-hidden="true" />
      </span>
      <h2 className="font-heading text-xl font-bold mb-2" style={{ color: "#1F3B36" }}>
        {t.title}
      </h2>
      <p className="font-semibold mb-2" style={{ color: "#1F3B36" }}>
        {t.lead}
      </p>
      <p className="text-sm leading-relaxed mb-4" style={{ color: "#4B5B58" }}>
        {schoolText(lang).refundPolicy}
      </p>
      <Link to={SCHOOL_PATHS[lang].refund} className="text-sm font-semibold underline" style={{ color: "#305D55" }}>
        {t.link}
      </Link>
    </article>
  );
}

function TicketForm({ lang }: { lang: SchoolLang }) {
  const t = TEXT[lang];
  const [params] = useSearchParams();
  const topic = params.get("topic");
  const { student } = useStudent();
  const [form, setForm] = useState<FormState>({
    name: "",
    email: "",
    category: isRequestCategory(topic) ? topic : "",
    reference: "",
    subject: "",
    message: "",
  });
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentNumber, setSentNumber] = useState("");

  // A logged-in student doesn't retype what we already know.
  useEffect(() => {
    if (!student) return;
    setForm((f) => ({
      ...f,
      name: f.name || `${student.first_name} ${student.last_name}`.trim(),
      email: f.email || student.email,
      reference: f.reference || student.public_ref || "",
    }));
  }, [student]);

  // Coming from a link with a topic (?topic=other…): go straight to the form.
  useEffect(() => {
    if (!isRequestCategory(topic)) return;
    const id = window.setTimeout(() => document.getElementById("ticket")?.scrollIntoView({ behavior: "smooth" }), 150);
    return () => window.clearTimeout(id);
  }, [topic]);

  const set = <K extends Field>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  function fieldMessage(field: Field, code: TicketFieldError | undefined): string | undefined {
    if (!code) return undefined;
    if (field === "message" && code === "too_long") return t.fieldErrors.messageTooLong;
    return t.fieldErrors[field];
  }

  function validate(): Partial<Record<Field, string>> {
    const next: Partial<Record<Field, TicketFieldError>> = {};
    if (!form.name.trim()) next.name = "required";
    if (!EMAIL_RE.test(form.email.trim())) next.email = "invalid";
    if (!form.category) next.category = "invalid";
    if (form.reference.trim() && !/^[A-Z0-9-]{3,40}$/i.test(form.reference.trim())) next.reference = "invalid";
    if (form.subject.trim().length < 3) next.subject = "too_short";
    if (form.message.trim().length < 10) next.message = "too_short";
    if (form.message.trim().length > 5000) next.message = "too_long";
    return Object.fromEntries(
      Object.entries(next).map(([k, code]) => [k, fieldMessage(k as Field, code)]),
    ) as Partial<Record<Field, string>>;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const local = validate();
    setErrors(local);
    if (Object.keys(local).length) {
      setSummary(t.summaryError);
      return;
    }
    setSummary("");
    setBusy(true);
    const input: TicketInput = {
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      category: form.category as RequestCategory,
      reference: form.reference.trim() || undefined,
      subject: form.subject.trim(),
      message: form.message.trim(),
      lang,
      website,
    };
    const res = await createTicket(input);
    setBusy(false);
    if ("number" in res) {
      setSentNumber(res.number);
      document.getElementById("ticket")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if ("fields" in res) {
      const server: Partial<Record<Field, string>> = {};
      for (const [k, code] of Object.entries(res.fields)) {
        if (k in form) server[k as Field] = fieldMessage(k as Field, code as TicketFieldError);
      }
      setErrors(server);
      setSummary(t.summaryError);
    } else {
      setSummary("error" in res && res.error === "rate_limited" ? t.rateLimited : t.sendError);
    }
  }

  if (sentNumber) {
    return (
      <div role="status" className="border bg-white p-6 sm:p-8" style={{ borderColor: "#E3EDE7" }}>
        <span className="mb-4 flex size-11 items-center justify-center rounded-full" style={{ background: "#305D55" }}>
          <CircleCheck className="size-6 text-white" aria-hidden="true" />
        </span>
        <p className="font-heading text-xl font-bold mb-2" style={{ color: "#1F3B36" }}>
          {t.success.title(sentNumber)}
        </p>
        <p className="text-base leading-relaxed mb-2" style={{ color: "#4B5B58" }}>
          {t.success.body}
        </p>
        <p className="text-sm mb-6" style={{ color: "#6B7672" }}>
          {t.success.keep}
        </p>
        <button
          type="button"
          onClick={() => {
            setSentNumber("");
            setForm((f) => ({ ...f, subject: "", message: "" }));
          }}
          className="px-5 py-2.5 text-sm font-semibold"
          style={{ border: "1px solid #305D55", color: "#305D55" }}
        >
          {t.success.another}
        </button>
      </div>
    );
  }

  // A business project goes through the booking calendar: no free-text request. The topic select keeps its
  // place, so changing the topic with the keyboard keeps the focus on it.
  const project = form.category === "project";

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {summary && !project && (
        <div
          role="alert"
          className="rounded-md p-3 text-sm"
          style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C" }}
        >
          {summary}
        </div>
      )}
      {!project && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ticket-name" className="block text-sm font-medium mb-1">
              {t.form.name}
            </label>
            <input
              id="ticket-name"
              autoComplete="name"
              maxLength={100}
              className={inputBase}
              style={border(errors.name)}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
            <FieldError message={errors.name} />
          </div>
          <div>
            <label htmlFor="ticket-email" className="block text-sm font-medium mb-1">
              {t.form.email}
            </label>
            <input
              id="ticket-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={160}
              className={inputBase}
              style={border(errors.email)}
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              aria-describedby="ticket-email-help"
            />
            <FieldError message={errors.email} />
            <p id="ticket-email-help" className="mt-1 text-xs" style={{ color: "#6B7672" }}>
              {t.form.emailHelp}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ticket-category" className="block text-sm font-medium mb-1">
            {t.form.category}
          </label>
          <select
            id="ticket-category"
            className={inputBase}
            style={border(errors.category)}
            value={form.category}
            onChange={(e) => set("category", e.target.value as RequestCategory)}
          >
            <option value="">{t.form.choose}</option>
            {REQUEST_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[lang][c]}
              </option>
            ))}
          </select>
          <FieldError message={errors.category} />
        </div>
        {!project && (
          <div>
            <label htmlFor="ticket-reference" className="block text-sm font-medium mb-1">
              {t.form.reference}
            </label>
            <input
              id="ticket-reference"
              maxLength={40}
              placeholder="ECO-XXXXXXXX"
              className={`${inputBase} uppercase`}
              style={border(errors.reference)}
              value={form.reference}
              onChange={(e) => set("reference", e.target.value)}
              aria-describedby="ticket-reference-help"
            />
            <FieldError message={errors.reference} />
            <p id="ticket-reference-help" className="mt-1 text-xs" style={{ color: "#6B7672" }}>
              {t.form.referenceHelp}
            </p>
          </div>
        )}
      </div>

      {project ? (
        <div className="rounded-md p-5" style={{ background: "#F3F8F5", border: "1px solid #E3EDE7" }}>
          <p className="text-base leading-relaxed mb-4" style={{ color: "#1F3B36" }}>
            {t.bookCall.body}
          </p>
          <Link
            to={SCHOOL_PATHS[lang].book}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white"
            style={{ background: "#305D55" }}
          >
            <CalendarClock className="size-4" aria-hidden="true" />
            {t.bookCall.button}
          </Link>
        </div>
      ) : (
        <>
          <div>
            <label htmlFor="ticket-subject" className="block text-sm font-medium mb-1">
              {t.form.subject}
            </label>
            <input
              id="ticket-subject"
              maxLength={150}
              className={inputBase}
              style={border(errors.subject)}
              value={form.subject}
              onChange={(e) => set("subject", e.target.value)}
            />
            <FieldError message={errors.subject} />
          </div>

          <div>
            <label htmlFor="ticket-message" className="block text-sm font-medium mb-1">
              {t.form.message}
            </label>
            <textarea
              id="ticket-message"
              rows={7}
              maxLength={5000}
              className={inputBase}
              style={border(errors.message)}
              value={form.message}
              onChange={(e) => set("message", e.target.value)}
            />
            <FieldError message={errors.message} />
          </div>

          <input
            type="text"
            name="website"
            tabIndex={-1}
            aria-hidden="true"
            autoComplete="off"
            className="hidden"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />

          <button
            type="submit"
            disabled={busy}
            className="px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "#305D55" }}
          >
            {busy ? t.form.sending : t.form.submit}
          </button>
        </>
      )}
    </form>
  );
}

export default function HelpCenter() {
  const lang = useSchoolLang();
  const t = TEXT[lang];
  const location = useLocation();
  const path = SCHOOL_PATHS[lang].help;

  return (
    <>
      <Seo
        title={t.seoTitle}
        description={t.seoDescription}
        path={path}
        lang={lang}
        alternates={{ en: SCHOOL_PATHS.en.help, fr: SCHOOL_PATHS.fr.help }}
      />

      <section className="px-6 pb-14 pt-32 lg:px-12" style={{ background: "#FBF7F0" }}>
        <div className="mx-auto max-w-5xl">
          <p className="mb-4 font-heading text-sm font-bold" style={{ color: "#305D55" }}>
            Reetma
            <Link
              to={alternateSchoolPath(location.pathname) + location.search}
              lang={lang === "fr" ? "en" : "fr"}
              className="ml-3 text-xs font-semibold underline"
              style={{ color: "#6B7672" }}
            >
              {t.switchLabel}
            </Link>
          </p>
          <h1 className="font-heading text-3xl font-bold mb-3 sm:text-4xl" style={{ color: "#1F3B36" }}>
            {t.title}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed sm:text-lg" style={{ color: "#4B5B58" }}>
            {t.intro}
          </p>

          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <ForgotPassword lang={lang} />
            <RefundBlock lang={lang} />
          </div>
        </div>
      </section>

      <section id="ticket" className="scroll-mt-24 px-6 py-16 lg:px-12">
        <div className="mx-auto max-w-2xl">
          <div
            className="mb-10 flex items-start gap-3 rounded-md p-4 text-sm leading-relaxed"
            style={{ background: "#FBF6EE", border: "1px solid #E3EDE7", color: "#3A4F4A" }}
          >
            <MailX className="mt-0.5 size-5 shrink-0" style={{ color: "#305D55" }} aria-hidden="true" />
            <p>{t.noReply}</p>
          </div>
          <h2 className="font-heading text-2xl font-bold mb-6" style={{ color: "#1F3B36" }}>
            {t.form.title}
          </h2>
          <TicketForm lang={lang} />
        </div>
      </section>
    </>
  );
}
