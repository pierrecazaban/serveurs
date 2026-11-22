import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js";
import { Link } from "react-router-dom";
import { schoolConfig, schoolText } from "@/config/school";
import { Fill } from "@/components/school/Fill";
import { HelpCenterLink } from "@/components/school/HelpCenterLink";
import { HEARD_ABOUT, REGISTRATION_TEXT } from "@/components/school/registrationText";
import { SCHOOL_PATHS, intakeLabel, useSchoolLang } from "@/lib/school/lang";
import { WaitlistForm } from "@/components/school/WaitlistForm";
import { PaymentStep } from "@/components/school/PaymentStep";
import { recordFunnelEvent, startRegistration } from "@/lib/school/api";
import { setPresenceStep, type PresenceStep } from "@/lib/presence";
import type { PublicIntake, University } from "@/lib/school/types";

const FORM_KEY = "school_form_state";
const RESERVATION_KEY = "school_reservation";

const COUNTRIES: { code: string; label: string; dial: string }[] = [
  { code: "US", label: "United States", dial: "+1" },
  { code: "CA", label: "Canada", dial: "+1" },
  { code: "MX", label: "Mexico", dial: "+52" },
  { code: "GB", label: "United Kingdom", dial: "+44" },
  { code: "FR", label: "France", dial: "+33" },
  { code: "DE", label: "Germany", dial: "+49" },
  { code: "ES", label: "Spain", dial: "+34" },
  { code: "IN", label: "India", dial: "+91" },
  { code: "CN", label: "China", dial: "+86" },
  { code: "BR", label: "Brazil", dial: "+55" },
  { code: "NG", label: "Nigeria", dial: "+234" },
];

interface FormState {
  university_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_country: string;
  phone_national: string;
  preferred_times: string[];
  timezone: string;
  major: string;
  graduation_year: string;
  heard_about: string;
  terms_accepted: boolean;
  withdrawal_waiver: boolean;
  age_confirmed: boolean;
  independence_acknowledged: boolean;
  marketing_opt_in: boolean;
  sms_opt_in: boolean;
}

const EMPTY: FormState = {
  university_id: "",
  first_name: "",
  last_name: "",
  email: "",
  phone_country: "US",
  phone_national: "",
  preferred_times: [],
  timezone: "",
  major: "",
  graduation_year: "",
  heard_about: "",
  terms_accepted: false,
  withdrawal_waiver: false,
  age_confirmed: false,
  independence_acknowledged: false,
  marketing_opt_in: false,
  sms_opt_in: false,
};

interface Reservation {
  registration_id: string;
  client_token: string;
  checkout_url?: string;
  hold_expires_at: string;
  public_ref: string;
}


const inputBase =
  "w-full rounded-md border px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[#305D55]/40";

export function RegistrationForm({
  intake,
  universities,
  onPaymentStarted,
}: {
  intake: PublicIntake | null;
  universities: University[];
  onPaymentStarted?: () => void;
}) {
  const lang = useSchoolLang();
  const t = REGISTRATION_TEXT[lang];
  const text = schoolText(lang);
  const paths = SCHOOL_PATHS[lang];
  const intakeName = intakeLabel(intake?.name, lang) || t.thisIntake;
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(() => {
    try {
      const raw = sessionStorage.getItem(FORM_KEY);
      if (!raw) return EMPTY;
      const saved = JSON.parse(raw) as Partial<FormState>;
      // Consent checkboxes must never be pre-selected, even after a reload.
      return {
        ...EMPTY,
        ...saved,
        terms_accepted: false,
        withdrawal_waiver: false,
        age_confirmed: false,
        independence_acknowledged: false,
        marketing_opt_in: false,
        sms_opt_in: false,
      };
    } catch {
      return EMPTY;
    }
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summaryError, setSummaryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [flow, setFlow] = useState<"form" | "full" | "closed" | "already">("form");
  const [notListedOpen, setNotListedOpen] = useState(false);
  const [universityQuery, setUniversityQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editUniversityQuery, setEditUniversityQuery] = useState("");
  const [editDropdownOpen, setEditDropdownOpen] = useState(false);
  const editUniversityRef = useRef<HTMLDivElement>(null);
  const honeypot = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const startedRef = useRef(false);
  const universityRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const { terms_accepted, withdrawal_waiver, age_confirmed, independence_acknowledged, marketing_opt_in, sms_opt_in, ...persistable } = form;
      sessionStorage.setItem(FORM_KEY, JSON.stringify(persistable));
    } catch {
      /* storage unavailable */
    }
  }, [form]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (universityRef.current && !universityRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
      if (editUniversityRef.current && !editUniversityRef.current.contains(event.target as Node)) {
        setEditDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!form.timezone) {
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setForm((f) => ({ ...f, timezone: browserTz || "" }));
    }
  }, [form.timezone]);

  useEffect(() => {
    if (step > 1 && headingRef.current) headingRef.current.focus();
  }, [step]);

  // Back-office audience: the form step this visit is on, once the form is started (step 4 = payment).
  useEffect(() => {
    if (startedRef.current || step > 1) setPresenceStep(`form_${step}` as PresenceStep);
  }, [step]);
  useEffect(() => () => setPresenceStep(null), []);

  const university = universities.find((u) => u.id === form.university_id) ?? null;

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (!startedRef.current) {
      startedRef.current = true;
      setPresenceStep("form_1");
      recordFunnelEvent("register_start");
    }
  }, []);

  const matchedUniversities = useMemo(() => {
    const q = universityQuery.trim().toLowerCase();
    if (!q) return universities;
    return universities.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.short_name.toLowerCase().includes(q) ||
        u.state.toLowerCase().includes(q),
    );
  }, [universities, universityQuery]);

  const filteredUniversities = useMemo(
    () => matchedUniversities.slice(0, 60),
    [matchedUniversities],
  );

  const editMatchedUniversities = useMemo(() => {
    const q = editUniversityQuery.trim().toLowerCase();
    if (!q) return universities;
    return universities.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.short_name.toLowerCase().includes(q) ||
        u.state.toLowerCase().includes(q),
    );
  }, [universities, editUniversityQuery]);

  const editFilteredUniversities = useMemo(
    () => editMatchedUniversities.slice(0, 60),
    [editMatchedUniversities],
  );


  function validateStep(target: number): boolean {
    const next: Record<string, string> = {};
    if (target >= 1 && !form.university_id) next.university_id = t.errors.university;

    if (target >= 2) {
      if (!form.first_name.trim()) next.first_name = t.errors.firstName;
      if (!form.last_name.trim()) next.last_name = t.errors.lastName;
      const email = form.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        next.email = t.errors.email;
      }
      const phone = parsePhoneNumberFromString(form.phone_national, form.phone_country as never);
      if (!phone || !phone.isValid()) next.phone_national = t.errors.phone;
    }

    if (target >= 3) {
      if (!form.terms_accepted) next.terms_accepted = t.errors.terms;
      if (!form.withdrawal_waiver) next.withdrawal_waiver = t.errors.waiver;
      if (!form.age_confirmed) next.age_confirmed = t.errors.age;
      if (!form.independence_acknowledged)
        next.independence_acknowledged = t.errors.independence;
    }

    setErrors(next);
    setSummaryError(Object.keys(next).length ? t.errors.summary : "");
    return Object.keys(next).length === 0;
  }

  function goTo(target: number) {
    if (target > step && !validateStep(step)) return;
    if (target > step) {
      setPresenceStep(`form_${target}` as PresenceStep); // the event then carries the new step: a single request
      recordFunnelEvent(`step_${step}_done`, form.university_id || undefined);
    }
    setStep(target);
  }

  async function submitRegistration() {
    if (!validateStep(3)) return;
    setBusy(true);
    setSummaryError("");
    const phone = parsePhoneNumberFromString(form.phone_national, form.phone_country as never);

    const res = await startRegistration({
      university_id: form.university_id,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim().toLowerCase(),
      phone_e164: phone?.number ?? "",
      phone_country: form.phone_country,
      major: form.major.trim() || undefined,
      graduation_year: form.graduation_year ? Number(form.graduation_year) : undefined,
      preferred_times: form.preferred_times,
      heard_about: form.heard_about || undefined,
      timezone: form.timezone,
      marketing_opt_in: form.marketing_opt_in,
      sms_opt_in: schoolConfig.SMS_ENABLED && form.sms_opt_in,
      website: honeypot.current?.value ?? "",
      // consent fields are checked again server-side
      age_confirmed: form.age_confirmed,
      independence_acknowledged: form.independence_acknowledged,
      terms_accepted: form.terms_accepted,
      withdrawal_waiver: form.withdrawal_waiver,
      terms_version: schoolConfig.termsVersion,
      lang,
    });
    setBusy(false);

    if (res.result === "reserved" || res.result === "resume") {
      const value: Reservation = {
        registration_id: res.registration_id,
        client_token: res.client_token,
        checkout_url: res.checkout_url,
        hold_expires_at: res.hold_expires_at,
        public_ref: res.public_ref,
      };
      setReservation(value);
      try {
        sessionStorage.setItem(RESERVATION_KEY, JSON.stringify(value));
      } catch {
        /* storage unavailable */
      }
      // A single request on arrival at the payment step: step_3_done carries form_4 (PaymentStep only reports the
      // click on "Pay").
      setPresenceStep("form_4");
      recordFunnelEvent("step_3_done", form.university_id);
      onPaymentStarted?.();
      setStep(4);
      return;
    }

    if (res.result === "already_registered") {
      setFlow("already");
    } else if (res.result === "full") {
      setFlow("full");
    } else if (res.result === "closed") {
      setFlow("closed");
    } else if (res.result === "payments_unavailable") {
      setSummaryError(t.errors.paymentsUnavailable);
    } else if (res.result === "rate_limited") {
      setSummaryError(t.errors.rateLimited);
    } else if (res.result === "invalid") {
      // The server repeats the client checks: show our own wording for each field it flags.
      const fieldMessages: Record<string, string> = {
        university_id: t.errors.university, first_name: t.errors.firstName, last_name: t.errors.lastName,
        email: t.errors.email, phone_national: t.errors.phone, terms_accepted: t.errors.terms,
        withdrawal_waiver: t.errors.waiver, age_confirmed: t.errors.age, independence_acknowledged: t.errors.independence,
      };
      setErrors(Object.fromEntries(Object.keys(res.errors ?? {}).map((k) => [k, fieldMessages[k] ?? t.errors.summary])));
      setSummaryError(t.errors.summary);
      setStep(2);
    } else {
      setSummaryError(t.errors.generic);
    }
  }

  const graduationYears = useMemo(() => {
    const year = new Date().getFullYear();
    return Array.from({ length: 7 }, (_, i) => year + i);
  }, []);

  const hideHeardAbout = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("utm_source");

  // ---------- alternative flows ----------

  if (flow === "already") {
    return (
      <div className="space-y-3">
        <p className="text-base" style={{ color: "#1F3B36" }}>
          {t.alreadyBefore(intakeName)}
          <HelpCenterLink />
          {t.alreadyAfter}
        </p>
      </div>
    );
  }

  if (flow === "full" || flow === "closed") {
    return (
      <div className="space-y-4">
        <p className="text-base font-medium" style={{ color: "#1F3B36" }}>
          {flow === "full" ? t.lastSeatTaken : t.closed(intakeName)}
        </p>
        <WaitlistForm
          reason={flow === "full" ? "intake_full" : "registration_closed"}
          intakeId={intake?.intake_id}
          universityId={form.university_id || undefined}
          defaultFirstName={form.first_name}
          defaultEmail={form.email}
          consentLabel={t.nextIntakeConsent}
        />
      </div>
    );
  }

  // ---------- main form ----------

  return (
    <div>
      <p className="text-sm font-medium mb-2" style={{ color: "#6B7672" }}>
        {t.stepOf(step)}
      </p>
      <div className="mb-8 h-1 w-full rounded-full" style={{ background: "#EAF1EC" }}>
        <div
          className="h-1 rounded-full transition-all duration-300"
          style={{ width: `${(step / 4) * 100}%`, background: "#305D55" }}
        />
      </div>

      <h3
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-xl font-bold mb-6 outline-none"
        style={{ color: "#1F3B36" }}
      >
        {t.headings[step - 1]}
      </h3>

      {summaryError && step !== 4 && (
        <div
          role="alert"
          className="mb-6 rounded-md p-3 text-sm"
          style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C" }}
        >
          {summaryError}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div className="relative" ref={universityRef}>
            <label htmlFor="university-search" className="block text-sm font-medium mb-1">
              {t.searchUniversity}
            </label>
            <input
              id="university-search"
              className={inputBase}
              style={{ borderColor: errors.university_id ? "#FCA5A5" : "#DDD5C7" }}
              value={isDropdownOpen || !form.university_id ? universityQuery : (university?.name ?? "")}
              onChange={(e) => {
                setUniversityQuery(e.target.value);
                if (form.university_id) set("university_id", "");
                setIsDropdownOpen(true);
              }}
              onFocus={() => setIsDropdownOpen(true)}
              placeholder={t.universityPlaceholder}
              autoComplete="off"
              aria-expanded={isDropdownOpen}
              aria-controls="university-listbox"
            />
            {isDropdownOpen && (
              <ul
                id="university-listbox"
                role="listbox"
                className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-white shadow-sm"
                style={{ borderColor: "#ECE5D9" }}
              >
                {filteredUniversities.length === 0 && (
                  <li className="px-3 py-3 text-sm" style={{ color: "#6B7672" }}>
                    {t.noMatch}
                  </li>
                )}
                {filteredUniversities.map((u) => (
                  <li key={u.id} role="option" aria-selected={form.university_id === u.id}>
                    <button
                      type="button"
                      onClick={() => {
                        set("university_id", u.id);
                        setUniversityQuery(u.name);
                        setIsDropdownOpen(false);
                      }}
                      className="flex w-full items-center justify-between px-3 py-3 text-left text-sm hover:bg-[#FBF6EE] focus:bg-[#FBF6EE] focus:outline-none"
                      style={{
                        background: form.university_id === u.id ? "#FBF6EE" : undefined,
                        color: "#1F3B36",
                      }}
                    >
                      <span>
                        {u.name} <span style={{ color: "#9AA49F" }}>({u.state})</span>
                      </span>
                      {form.university_id === u.id && (
                        <span className="text-xs font-semibold" style={{ color: "#305D55" }}>
                          {t.selected}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {matchedUniversities.length > filteredUniversities.length && isDropdownOpen && (
              <p className="mt-2 text-xs" style={{ color: "#6B7672" }}>
                {t.showing(filteredUniversities.length, matchedUniversities.length)}
              </p>
            )}
            {errors.university_id && (
              <p className="mt-2 text-sm" style={{ color: "#B91C1C" }}>
                {errors.university_id}
              </p>
            )}
          </div>

          <p className="text-xs leading-relaxed" style={{ color: "#6B7672" }}>
            {text.independenceNotice}
          </p>

          <div>
            <button
              type="button"
              onClick={() => setNotListedOpen((v) => !v)}
              className="text-sm font-medium underline"
              style={{ color: "#305D55" }}
            >
              {t.notListed}
            </button>
            {notListedOpen && (
              <div className="mt-4 rounded-md p-4" style={{ background: "#FBF7F0" }}>
                <WaitlistForm
                  reason="university_not_listed"
                  showUniversityField
                  consentLabel={t.notListedConsent}
                />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => goTo(2)}
            className="px-6 py-3 text-sm font-semibold text-white"
            style={{ background: "#305D55" }}
          >
            {t.continue}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="first_name" className="block text-sm font-medium mb-1">
                {t.firstName}
              </label>
              <input
                id="first_name"
                className={inputBase}
                style={{ borderColor: errors.first_name ? "#FCA5A5" : "#DDD5C7" }}
                value={form.first_name}
                onChange={(e) => set("first_name", e.target.value)}
                aria-describedby="name-help"
                autoComplete="given-name"
              />
              {errors.first_name && (
                <p className="mt-1 text-sm" style={{ color: "#B91C1C" }}>
                  {errors.first_name}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="last_name" className="block text-sm font-medium mb-1">
                {t.lastName}
              </label>
              <input
                id="last_name"
                className={inputBase}
                style={{ borderColor: errors.last_name ? "#FCA5A5" : "#DDD5C7" }}
                value={form.last_name}
                onChange={(e) => set("last_name", e.target.value)}
                autoComplete="family-name"
              />
              {errors.last_name && (
                <p className="mt-1 text-sm" style={{ color: "#B91C1C" }}>
                  {errors.last_name}
                </p>
              )}
            </div>
          </div>
          <p id="name-help" className="text-xs" style={{ color: "#6B7672" }}>
            {t.nameHelp}
          </p>

          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              {t.email}
            </label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              className={inputBase}
              style={{ borderColor: errors.email ? "#FCA5A5" : "#DDD5C7" }}
              placeholder={t.emailPlaceholder}
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              aria-describedby="email-help"
            />
            {errors.email && (
              <p className="mt-1 text-sm" style={{ color: "#B91C1C" }}>
                {errors.email}
              </p>
            )}
            <p id="email-help" className="mt-1 text-xs" style={{ color: "#6B7672" }}>
              {t.emailHelp}
            </p>
          </div>

          <div>
            <label htmlFor="phone" className="block text-sm font-medium mb-1">
              {t.phone}
            </label>
            <div className="flex gap-2">
              <select
                aria-label={t.countryCode}
                className="rounded-md border px-2 py-2.5 text-base"
                style={{ borderColor: "#DDD5C7" }}
                value={form.phone_country}
                onChange={(e) => set("phone_country", e.target.value)}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} {c.dial}
                  </option>
                ))}
              </select>
              <input
                id="phone"
                type="tel"
                autoComplete="tel"
                className={inputBase}
                style={{ borderColor: errors.phone_national ? "#FCA5A5" : "#DDD5C7" }}
                value={form.phone_national}
                onChange={(e) =>
                  set(
                    "phone_national",
                    new AsYouType(form.phone_country as never).input(e.target.value),
                  )
                }
                aria-describedby="phone-help"
              />
            </div>
            {errors.phone_national && (
              <p className="mt-1 text-sm" style={{ color: "#B91C1C" }}>
                {errors.phone_national}
              </p>
            )}
            <p id="phone-help" className="mt-1 text-xs" style={{ color: "#6B7672" }}>
              {t.phoneHelp}
            </p>
          </div>

          <div className="rounded-md border" style={{ borderColor: "#ECE5D9" }}>
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
              style={{ color: "#1F3B36" }}
            >
              {t.advanced}
              <span aria-hidden="true">{advancedOpen ? "–" : "+"}</span>
            </button>
            {advancedOpen && (
              <div className="space-y-4 px-4 pb-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="major" className="block text-sm font-medium mb-1">
                      {t.major}
                    </label>
                    <input
                      id="major"
                      className={inputBase}
                      style={{ borderColor: "#DDD5C7" }}
                      value={form.major}
                      onChange={(e) => set("major", e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="graduation_year" className="block text-sm font-medium mb-1">
                      {t.graduationYear}
                    </label>
                    <select
                      id="graduation_year"
                      className={inputBase}
                      style={{ borderColor: "#DDD5C7" }}
                      value={form.graduation_year}
                      onChange={(e) => set("graduation_year", e.target.value)}
                    >
                      <option value="">{t.select}</option>
                      {graduationYears.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {!hideHeardAbout && (
                  <div>
                    <label htmlFor="heard_about" className="block text-sm font-medium mb-1">
                      {t.heardAbout}
                    </label>
                    <select
                      id="heard_about"
                      className={inputBase}
                      style={{ borderColor: "#DDD5C7" }}
                      value={form.heard_about}
                      onChange={(e) => set("heard_about", e.target.value)}
                    >
                      <option value="">{t.select}</option>
                      {HEARD_ABOUT.map((h) => (
                        <option key={h.value} value={h.value}>
                          {h[lang]}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          <input
            ref={honeypot}
            type="text"
            tabIndex={-1}
            aria-hidden="true"
            autoComplete="off"
            name="website"
            className="hidden"
          />

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="px-5 py-3 text-sm font-semibold"
              style={{ border: "1px solid #DDD5C7", color: "#4B5B58" }}
            >
              {t.back}
            </button>
            <button
              type="button"
              onClick={() => goTo(3)}
              className="px-6 py-3 text-sm font-semibold text-white"
              style={{ background: "#305D55" }}
            >
              {t.continue}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6">
          <dl className="divide-y text-sm" style={{ borderColor: "#ECE5D9" }}>
            {[
              { key: "university", label: t.rows.university, value: university?.name ?? "" },
              { key: "name", label: t.rows.name, value: `${form.first_name} ${form.last_name}`.trim() },
              { key: "email", label: t.rows.email, value: form.email },
              { key: "phone", label: t.rows.phone, value: form.phone_national },
              { key: null, label: t.rows.intake, value: intakeLabel(intake?.name, lang) },
              { key: null, label: t.rows.format, value: t.rows.formatValue },
              { key: null, label: t.rows.access, value: t.rows.accessValue },
            ].map((row) => {
              const isEditing = row.key !== null && editingField === row.key;
              return (
                <div key={row.label} className="py-3">
                  <div className="flex items-start justify-between gap-4">
                    <dt style={{ color: "#6B7672" }}>{row.label}</dt>
                    {!isEditing && (
                      <dd className="flex items-center gap-3 text-right" style={{ color: "#1F3B36" }}>
                        <span className="break-all">{row.value}</span>
                        {row.key && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingField(row.key);
                              if (row.key === "university") {
                                setEditUniversityQuery(university?.name ?? "");
                                setEditDropdownOpen(true);
                              }
                            }}
                            className="text-xs underline"
                            style={{ color: "#305D55" }}
                          >
                            {t.edit}
                          </button>
                        )}
                      </dd>
                    )}
                  </div>

                  {isEditing && (
                    <div className="mt-3 space-y-2">
                      {row.key === "university" && (
                        <div className="relative" ref={editUniversityRef}>
                          <input
                            className={inputBase}
                            style={{ borderColor: "#DDD5C7" }}
                            value={editUniversityQuery}
                            onChange={(e) => {
                              setEditUniversityQuery(e.target.value);
                              setEditDropdownOpen(true);
                            }}
                            onFocus={() => setEditDropdownOpen(true)}
                            placeholder={t.universityPlaceholder}
                            autoComplete="off"
                          />
                          {editDropdownOpen && (
                            <ul
                              role="listbox"
                              className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-white shadow-sm"
                              style={{ borderColor: "#ECE5D9" }}
                            >
                              {editFilteredUniversities.length === 0 && (
                                <li className="px-3 py-3 text-sm" style={{ color: "#6B7672" }}>
                                  {t.noMatch}
                                </li>
                              )}
                              {editFilteredUniversities.map((u) => (
                                <li key={u.id} role="option" aria-selected={form.university_id === u.id}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      set("university_id", u.id);
                                      setEditUniversityQuery(u.name);
                                      setEditDropdownOpen(false);
                                    }}
                                    className="flex w-full items-center justify-between px-3 py-3 text-left text-sm hover:bg-[#FBF6EE] focus:bg-[#FBF6EE] focus:outline-none"
                                    style={{
                                      background: form.university_id === u.id ? "#FBF6EE" : undefined,
                                      color: "#1F3B36",
                                    }}
                                  >
                                    <span>
                                      {u.name} <span style={{ color: "#9AA49F" }}>({u.state})</span>
                                    </span>
                                    {form.university_id === u.id && (
                                      <span className="text-xs font-semibold" style={{ color: "#305D55" }}>
                                        {t.selected}
                                      </span>
                                    )}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                      {row.key === "name" && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input
                            className={inputBase}
                            style={{ borderColor: "#DDD5C7" }}
                            value={form.first_name}
                            onChange={(e) => set("first_name", e.target.value)}
                            placeholder={t.firstName}
                          />
                          <input
                            className={inputBase}
                            style={{ borderColor: "#DDD5C7" }}
                            value={form.last_name}
                            onChange={(e) => set("last_name", e.target.value)}
                            placeholder={t.lastName}
                          />
                        </div>
                      )}
                      {row.key === "email" && (
                        <input
                          type="email"
                          className={inputBase}
                          style={{ borderColor: "#DDD5C7" }}
                          value={form.email}
                          onChange={(e) => set("email", e.target.value)}
                          placeholder={t.emailPlaceholder}
                        />
                      )}
                      {row.key === "phone" && (
                        <input
                          type="tel"
                          className={inputBase}
                          style={{ borderColor: "#DDD5C7" }}
                          value={form.phone_national}
                          onChange={(e) => set("phone_national", e.target.value)}
                          placeholder={t.phonePlaceholder}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => setEditingField(null)}
                        className="px-4 py-2 text-xs font-semibold text-white rounded"
                        style={{ background: "#305D55" }}
                      >
                        {t.done}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </dl>

          <div
            className="space-y-4 rounded-lg p-5"
            style={{ background: "#FBF6EE", border: "1px solid #E3EDE7" }}
          >
            <div className="flex items-baseline justify-between gap-4 font-bold" style={{ color: "#1F3B36" }}>
              <span>{t.registrationFee}</span>
              <span className="text-xl">{text.priceDisplay}</span>
            </div>
          </div>

          <p className="text-xs" style={{ color: "#6B7672" }}>
            {t.checkAddress}
          </p>

          <p className="text-xs leading-relaxed" style={{ color: "#6B7672" }}>
            {text.independenceNotice}
          </p>

          <div className="space-y-3 text-sm" style={{ color: "#3A4F4A" }}>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={form.terms_accepted}
                onChange={(e) => set("terms_accepted", e.target.checked)}
              />
              <span>
                {t.terms.agree}
                <Link to={paths.terms} target="_blank" className="underline" style={{ color: "#305D55" }}>
                  {t.terms.terms}
                </Link>
                {t.terms.and}
                <Link to={paths.refund} target="_blank" className="underline" style={{ color: "#305D55" }}>
                  {t.terms.refund}
                </Link>
                {t.terms.read}
                <Link to="/legal/privacy" target="_blank" className="underline" style={{ color: "#305D55" }}>
                  {t.terms.privacy}
                </Link>
                .
              </span>
            </label>
            {errors.terms_accepted && (
              <p className="text-sm" style={{ color: "#B91C1C" }}>
                {errors.terms_accepted}
              </p>
            )}

            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={form.withdrawal_waiver}
                onChange={(e) => set("withdrawal_waiver", e.target.checked)}
              />
              <span>
                {t.waiver}
              </span>
            </label>
            {errors.withdrawal_waiver && (
              <p className="text-sm" style={{ color: "#B91C1C" }}>
                {errors.withdrawal_waiver}
              </p>
            )}

            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={form.age_confirmed}
                onChange={(e) => set("age_confirmed", e.target.checked)}
              />
              {t.age}
            </label>
            {errors.age_confirmed && (
              <p className="text-sm" style={{ color: "#B91C1C" }}>
                {errors.age_confirmed}
              </p>
            )}

            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={form.independence_acknowledged}
                onChange={(e) => set("independence_acknowledged", e.target.checked)}
              />
              {t.independence}
            </label>
            {errors.independence_acknowledged && (
              <p className="text-sm" style={{ color: "#B91C1C" }}>
                {errors.independence_acknowledged}
              </p>
            )}

            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={form.marketing_opt_in}
                onChange={(e) => set("marketing_opt_in", e.target.checked)}
              />
              {t.marketing}
            </label>

            {schoolConfig.SMS_ENABLED && (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={form.sms_opt_in}
                  onChange={(e) => set("sms_opt_in", e.target.checked)}
                />
                {t.sms}
              </label>
            )}
          </div>

          <p className="text-sm" style={{ color: "#4B5B58" }}>
            <Fill value={text.refundPolicy} />
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="px-5 py-3 text-sm font-semibold"
              style={{ border: "1px solid #DDD5C7", color: "#4B5B58" }}
            >
              {t.back}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={submitRegistration}
              className="px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "#305D55" }}
            >
              {busy ? t.reserving : t.toPayment}
            </button>
          </div>
          <p className="text-xs" style={{ color: "#6B7672" }}>
            {t.holdNote}
          </p>
        </div>
      )}

      {step === 4 && reservation && (
        <PaymentStep
          registrationId={reservation.registration_id}
          clientToken={reservation.client_token}
          checkoutUrl={reservation.checkout_url}
          holdExpiresAt={reservation.hold_expires_at}
          summary={{
            name: `${form.first_name} ${form.last_name}`,
            email: form.email,
            university: university?.name ?? "",
            intake: intakeLabel(intake?.name, lang),
          }}
          onBack={() => setStep(3)}
          onRetry={() => {
            setReservation(null);
            setStep(3);
          }}
        />
      )}
    </div>
  );
}