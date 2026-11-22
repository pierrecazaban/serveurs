import { useState } from "react";
import { recordFunnelEvent } from "@/lib/school/api";
import { useSchoolLang } from "@/lib/school/lang";
import { createTicket } from "@/components/help/helpApi";

interface Props {
  reason: "intake_full" | "university_not_listed" | "registration_closed";
  intakeId?: string;
  universityId?: string;
  defaultFirstName?: string;
  defaultEmail?: string;
  showUniversityField?: boolean;
  consentLabel: string;
  onDone?: () => void;
}

// A waitlist entry is a help-center ticket (category "waitlist"), so it shows up in /admin/tickets.
const TEXT = {
  en: {
    university: "Your university",
    firstName: "First name",
    email: "Student email",
    submit: "Add me to the list",
    sending: "Sending…",
    missing: "Fill in your first name, a valid email, and tick the box.",
    rateLimited: "Too many attempts. Wait a few minutes and try again.",
    error: "We couldn't save that. Try again in a moment.",
    done: (university: string) =>
      `Thanks. We'll email you ${university ? `if L'École opens to ${university}` : "as soon as we have news"}. Our emails may land in your spam folder: check it.`,
    subject: {
      intake_full: "Waitlist: intake full",
      registration_closed: "Waitlist: registration closed",
      university_not_listed: "Waitlist: university not listed",
    },
    lines: { reason: "Reason", intake: "Intake", universityId: "University (id)", university: "University", consent: "Agreed to be emailed" },
    yes: "yes",
  },
  fr: {
    university: "Votre université",
    firstName: "Prénom",
    email: "E-mail étudiant",
    submit: "M'ajouter à la liste",
    sending: "Envoi…",
    missing: "Indiquez votre prénom et une adresse e-mail valide, puis cochez la case.",
    rateLimited: "Trop de tentatives. Patientez quelques minutes puis réessayez.",
    error: "L'enregistrement n'a pas fonctionné. Réessayez dans un instant.",
    done: (university: string) =>
      `Merci. Nous vous écrirons ${university ? `si L'École s'ouvre à ${university}` : "dès que nous aurons du nouveau"}. Nos e-mails peuvent arriver dans les spams : pensez à vérifier.`,
    subject: {
      intake_full: "Liste d'attente : promotion complète",
      registration_closed: "Liste d'attente : inscriptions closes",
      university_not_listed: "Liste d'attente : université absente de la liste",
    },
    lines: { reason: "Motif", intake: "Promotion", universityId: "Université (id)", university: "Université", consent: "Accepte d'être contacté(e) par e-mail" },
    yes: "oui",
  },
} as const;

export function WaitlistForm({
  reason,
  intakeId,
  universityId,
  defaultFirstName = "",
  defaultEmail = "",
  showUniversityField = false,
  consentLabel,
  onDone,
}: Props) {
  const lang = useSchoolLang();
  const t = TEXT[lang];
  const [universityName, setUniversityName] = useState("");
  const [firstName, setFirstName] = useState(defaultFirstName);
  const [email, setEmail] = useState(defaultEmail);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p className="text-sm" style={{ color: "#305D55" }}>
        {t.done(showUniversityField ? universityName.trim() : "")}
      </p>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!firstName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !consent) {
      setError(t.missing);
      return;
    }
    setBusy(true);
    const university = showUniversityField ? universityName.trim() : "";
    const message = [
      `${t.lines.reason}: ${t.subject[reason]}`,
      intakeId ? `${t.lines.intake}: ${intakeId}` : "",
      universityId ? `${t.lines.universityId}: ${universityId}` : "",
      university ? `${t.lines.university}: ${university}` : "",
      `${t.lines.consent}: ${t.yes}`,
    ]
      .filter(Boolean)
      .join("\n");
    const res = await createTicket({
      name: firstName.trim(),
      email: email.trim().toLowerCase(),
      category: "waitlist",
      subject: university ? `${t.subject[reason]} (${university})`.slice(0, 150) : t.subject[reason],
      message,
      lang,
    });
    setBusy(false);
    if (res.ok) {
      recordFunnelEvent(reason === "university_not_listed" ? "not_listed_submit" : "waitlist_join");
      setDone(true);
      onDone?.();
    } else if ("error" in res && res.error === "rate_limited") {
      setError(t.rateLimited);
    } else {
      setError(t.error);
    }
  }

  const inputClass =
    "w-full rounded-md border px-3 py-2.5 text-base focus:outline-none focus:ring-2";

  return (
    <form onSubmit={submit} className="space-y-3">
      {showUniversityField && (
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="wl-university">
            {t.university}
          </label>
          <input
            id="wl-university"
            className={inputClass}
            style={{ borderColor: "#DDD5C7" }}
            value={universityName}
            onChange={(e) => setUniversityName(e.target.value)}
          />
        </div>
      )}
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="wl-first">
          {t.firstName}
        </label>
        <input
          id="wl-first"
          className={inputClass}
          style={{ borderColor: "#DDD5C7" }}
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="wl-email">
          {t.email}
        </label>
        <input
          id="wl-email"
          type="email"
          inputMode="email"
          className={inputClass}
          style={{ borderColor: "#DDD5C7" }}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <label className="flex items-start gap-2 text-sm" style={{ color: "#4B5B58" }}>
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        {consentLabel}
      </label>
      {error && (
        <p className="text-sm" role="alert" style={{ color: "#B91C1C" }}>
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "#305D55" }}
      >
        {busy ? t.sending : t.submit}
      </button>
    </form>
  );
}
