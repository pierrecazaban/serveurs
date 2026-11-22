import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock } from "lucide-react";
import type { SchoolLang } from "@/lib/school/lang";
import { BOOKING_TEXT } from "@/lib/booking/text";
import { bookCall, type BookingField, type BookingFieldError } from "@/lib/booking/api";
import { businessVerdict, companyLooksAcademic, emailLooksAcademic } from "@/lib/booking/businessFilter";
import { describeCall } from "@/lib/booking/time";
import { BusinessOnlyNotice } from "./BusinessOnlyNotice";
import { ERROR_BOX, PRIMARY_STYLE, SECONDARY_STYLE, border, inputBase, primaryButton, secondaryButton } from "./styles";

export interface BookingFormState {
  name: string;
  email: string;
  company: string;
  role: string;
  phone: string;
  message: string;
  business: boolean;
}

// Like the server (api/_bookingApi.js): control and bidi characters dropped, white space collapsed on one-line fields.
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const cleanLine = (v: string) => v.replace(HIDDEN, "").replace(/\s+/g, " ").trim();
const cleanText = (v: string) => v.replace(/\r\n?|[\v\f\u2028\u2029]/g, "\n").replace(HIDDEN, "").trim();
// Like the server: what displays as nothing (zero-width space, Hangul fillers…) never counts as typed text.
const shown = (v: string) => v.replace(/\p{Default_Ignorable_Code_Point}/gu, "");
const VISIBLE = /[\p{L}\p{N}]/u;
const visible = (v: string) => VISIBLE.test(shown(v));
// A plain ASCII address, like the server: exactly what the email provider delivers to.
const EMAIL_RE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
// Lenient, like the server: digits and the usual separators, 6 to 20 digits.
const PHONE_RE = /^\+?[\d\s().\-/]{6,30}$/;

type Errors = Partial<Record<BookingField, BookingFieldError>>;

function validate(f: BookingFormState): Errors {
  const e: Errors = {};
  const name = cleanLine(f.name);
  const email = f.email.trim();
  const company = cleanLine(f.company);
  const phone = cleanLine(f.phone);
  const message = cleanText(f.message);
  if (!visible(name)) e.name = "required";
  else if (name.length > 100) e.name = "too_long";
  if (email.length > 160 || !EMAIL_RE.test(email)) e.email = "invalid";
  if (company.length < 2) e.company = company ? "too_short" : "required";
  else if (company.length > 120) e.company = "too_long";
  else if (!visible(company)) e.company = "invalid";
  if (cleanLine(f.role).length > 100) e.role = "too_long";
  if (phone) {
    const digits = phone.replace(/\D/g, "").length;
    if (!PHONE_RE.test(phone) || digits < 6 || digits > 20) e.phone = "invalid";
  }
  const typed = shown(message).trim(); // the 20-character minimum counts what displays
  if (typed.length < 20) e.message = typed ? "too_short" : "required";
  else if (message.length > 2000) e.message = "too_long";
  if (!f.business) e.business = "required";
  return e;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm" style={{ color: "#B91C1C" }}>
      {message}
    </p>
  );
}

const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

/**
 * Step 2: who is booking. Checked here for instant feedback, and again by the server, whose verdict counts.
 * A slot taken in the meantime sends the visitor back to step 1 (onSlotUnavailable) with fresh slots.
 */
export function BookingForm({
  lang,
  value,
  onChange,
  start,
  durationMinutes,
  timeZone,
  cycle,
  onChangeTime,
  onBooked,
  onSlotUnavailable,
}: {
  lang: SchoolLang;
  value: BookingFormState;
  onChange: (value: BookingFormState) => void;
  start: number;
  durationMinutes: number;
  timeZone: string;
  cycle: "h12" | "h23";
  onChangeTime: () => void;
  onBooked: (number: string, start: number) => void;
  onSlotUnavailable: (reason: "taken" | "gone") => void;
}) {
  const text = BOOKING_TEXT[lang];
  const t = text.form;
  const [errors, setErrors] = useState<Errors>({});
  const [academic, setAcademic] = useState<"company" | "email" | null>(null);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [website, setWebsite] = useState("");
  const summaryRef = useRef<HTMLDivElement>(null);
  const call = describeCall(start, durationMinutes, timeZone, lang, cycle);

  const set = <K extends keyof BookingFormState>(key: K, v: BookingFormState[K]) => {
    onChange({ ...value, [key]: v });
    if (errors[key as BookingField]) setErrors((e) => ({ ...e, [key]: undefined }));
    if (academic === key) setAcademic(null);
  };

  function message(field: BookingField, code?: BookingFieldError): string | undefined {
    if (!code) return undefined;
    if (field === "message" && code === "too_long") return text.fieldErrors.messageTooLong;
    return text.fieldErrors[field];
  }

  const showSummary = (msg: string) => {
    setSummary(msg);
    window.setTimeout(() => summaryRef.current?.focus(), 0);
  };

  const refuse = (field: "company" | "email") => {
    setAcademic(field);
    window.setTimeout(() => document.getElementById(`booking-${field}`)?.focus(), 0);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const local = validate(value);
    setErrors(local);
    if (Object.keys(local).length) return showSummary(text.summaryError);
    const verdict = businessVerdict(value);
    if ("field" in verdict) {
      setSummary("");
      return refuse(verdict.field);
    }
    setSummary("");
    setBusy(true);
    const res = await bookCall({
      name: value.name.trim(),
      email: value.email.trim().toLowerCase(),
      company: value.company.trim(),
      role: value.role.trim(),
      phone: value.phone.trim(),
      message: value.message.trim(),
      business: value.business,
      start: new Date(start).toISOString(),
      tz: timeZone,
      lang,
      website,
    });
    setBusy(false);
    if ("number" in res) return onBooked(res.number, Date.parse(res.start) || start);
    if ("fields" in res) {
      if (res.fields.start) return onSlotUnavailable("gone");
      const { start: _start, ...fields } = res.fields;
      setErrors(fields);
      return showSummary(text.summaryError);
    }
    if ("field" in res) return refuse(res.field);
    switch (res.error) {
      case "slot_taken":
        return onSlotUnavailable("taken");
      case "invalid_slot":
        return onSlotUnavailable("gone");
      case "already_booked":
        return showSummary(text.alreadyBooked);
      case "rate_limited":
        return showSummary(text.rateLimited);
      default:
        return showSummary(text.sendError);
    }
  }

  const field = (id: BookingField) => `booking-${id}`;
  const errorId = (id: BookingField) => (errors[id] ? `booking-${id}-error` : undefined);
  const noticeId = (id: "company" | "email") => (academic === id ? `booking-${id}-notice` : undefined);

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-3 rounded-md p-4 sm:flex-row sm:items-center sm:justify-between" style={{ background: "#F3F8F5", border: "1px solid #E3EDE7" }}>
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 size-5 shrink-0" style={{ color: "#305D55" }} aria-hidden="true" />
          <div className="text-sm leading-relaxed" style={{ color: "#1F3B36" }}>
            <p className="font-semibold">{t.chosen}</p>
            <p>
              {call.local.date}, {call.local.range} <span style={{ color: "#4B5B58" }}>({timeZone})</span>
            </p>
            {call.paris && (
              <p className="text-xs" style={{ color: "#4B5B58" }}>
                {text.slot.parisLong(call.paris.date === call.local.date ? call.paris.range : `${call.paris.date}, ${call.paris.range}`)}
              </p>
            )}
          </div>
        </div>
        <button type="button" onClick={onChangeTime} className={`${secondaryButton} shrink-0 self-start sm:self-center`} style={SECONDARY_STYLE}>
          {t.change}
        </button>
      </div>

      <form onSubmit={submit} noValidate className="space-y-5">
        {summary && (
          <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-md p-3 text-sm leading-relaxed focus:outline-none" style={ERROR_BOX}>
            {summary}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={field("name")} className="mb-1 block text-sm font-medium">
              {t.name}
            </label>
            <input
              id={field("name")}
              autoComplete="name"
              maxLength={100}
              required
              aria-invalid={!!errors.name}
              aria-describedby={errorId("name")}
              className={inputBase}
              style={border(errors.name)}
              value={value.name}
              onChange={(e) => set("name", e.target.value)}
            />
            <FieldError id="booking-name-error" message={message("name", errors.name)} />
          </div>
          <div>
            <label htmlFor={field("email")} className="mb-1 block text-sm font-medium">
              {t.email}
            </label>
            <input
              id={field("email")}
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={160}
              required
              aria-invalid={!!errors.email || academic === "email"}
              aria-describedby={describedBy(errorId("email"), noticeId("email"), "booking-email-help")}
              className={inputBase}
              style={border(errors.email || academic === "email")}
              value={value.email}
              onChange={(e) => set("email", e.target.value)}
              onBlur={() => {
                const email = value.email.trim();
                if (EMAIL_RE.test(email) && emailLooksAcademic(email)) setAcademic("email");
              }}
            />
            <FieldError id="booking-email-error" message={message("email", errors.email)} />
            {academic === "email" && <BusinessOnlyNotice id="booking-email-notice" lang={lang} />}
            <p id="booking-email-help" className="mt-1 text-xs" style={{ color: "#6B7672" }}>
              {t.emailHelp}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={field("company")} className="mb-1 block text-sm font-medium">
              {t.company}
            </label>
            <input
              id={field("company")}
              autoComplete="organization"
              maxLength={120}
              required
              aria-invalid={!!errors.company || academic === "company"}
              aria-describedby={describedBy(errorId("company"), noticeId("company"))}
              className={inputBase}
              style={border(errors.company || academic === "company")}
              value={value.company}
              onChange={(e) => set("company", e.target.value)}
              onBlur={() => {
                if (companyLooksAcademic(value.company)) setAcademic("company");
              }}
            />
            <FieldError id="booking-company-error" message={message("company", errors.company)} />
            {academic === "company" && <BusinessOnlyNotice id="booking-company-notice" lang={lang} />}
          </div>
          <div>
            <label htmlFor={field("role")} className="mb-1 block text-sm font-medium">
              {t.role}
            </label>
            <input
              id={field("role")}
              autoComplete="organization-title"
              maxLength={100}
              aria-invalid={!!errors.role}
              aria-describedby={errorId("role")}
              className={inputBase}
              style={border(errors.role)}
              value={value.role}
              onChange={(e) => set("role", e.target.value)}
            />
            <FieldError id="booking-role-error" message={message("role", errors.role)} />
          </div>
        </div>

        <div className="sm:w-1/2 sm:pr-2">
          <label htmlFor={field("phone")} className="mb-1 block text-sm font-medium">
            {t.phone}
          </label>
          <input
            id={field("phone")}
            type="tel"
            autoComplete="tel"
            maxLength={30}
            aria-invalid={!!errors.phone}
            aria-describedby={errorId("phone")}
            className={inputBase}
            style={border(errors.phone)}
            value={value.phone}
            onChange={(e) => set("phone", e.target.value)}
          />
          <FieldError id="booking-phone-error" message={message("phone", errors.phone)} />
        </div>

        <div>
          <label htmlFor={field("message")} className="mb-1 block text-sm font-medium">
            {t.message}
          </label>
          <textarea
            id={field("message")}
            rows={6}
            maxLength={2000}
            required
            aria-invalid={!!errors.message}
            aria-describedby={describedBy(errorId("message"), "booking-message-help")}
            className={inputBase}
            style={border(errors.message)}
            value={value.message}
            onChange={(e) => set("message", e.target.value)}
          />
          <FieldError id="booking-message-error" message={message("message", errors.message)} />
          <p id="booking-message-help" className="mt-1 text-xs" style={{ color: "#6B7672" }}>
            {t.messageHelp}
          </p>
        </div>

        <div>
          <label className="flex items-start gap-2.5 text-sm leading-relaxed" style={{ color: "#3A4F4A" }}>
            <input
              id={field("business")}
              type="checkbox"
              required
              className="mt-1 size-4 shrink-0 accent-[#305D55]"
              aria-invalid={!!errors.business}
              aria-describedby={errorId("business")}
              checked={value.business}
              onChange={(e) => set("business", e.target.checked)}
            />
            <span>{t.business}</span>
          </label>
          <FieldError id="booking-business-error" message={message("business", errors.business)} />
        </div>

        <p className="text-xs leading-relaxed" style={{ color: "#6B7672" }}>
          {t.privacyBefore}
          {/* A new tab: the chosen time and the details typed stay on this page. */}
          <Link to="/legal/privacy#rendez-vous" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "#305D55" }}>
            {t.privacyLink}
            <span className="sr-only"> {text.done.newTab}</span>
          </Link>
          {t.privacyAfter}
        </p>

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

        <button type="submit" disabled={busy} className={primaryButton} style={PRIMARY_STYLE}>
          {busy ? t.sending : t.submit}
        </button>
      </form>
    </div>
  );
}
