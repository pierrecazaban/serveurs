import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap } from "lucide-react";
import { Seo } from "@/components/Seo";
import { SCHOOL_PATHS, alternateSchoolPath, useSchoolLang } from "@/lib/school/lang";
import { BOOKING_TEXT } from "@/lib/booking/text";
import { fetchSlots } from "@/lib/booking/api";
import { dateKey, hourCycle, visitorTimeZone } from "@/lib/booking/time";
import { SlotPicker } from "@/components/booking/SlotPicker";
import { BookingForm, type BookingFormState } from "@/components/booking/BookingForm";
import { BookingDone } from "@/components/booking/BookingDone";
import { ERROR_BOX, INFO_BOX, PRIMARY_STYLE, SECONDARY_STYLE, primaryButton, secondaryButton } from "@/components/booking/styles";

const EMPTY_FORM: BookingFormState = { name: "", email: "", company: "", role: "", phone: "", message: "", business: false };

type Step = 1 | 2 | 3;

// The unfinished booking (time and details) survives leaving the page in the same tab (browser Back then Forward,
// a link, a reload) for the session, like the registration form's draft; a confirmed booking clears it.
const DRAFT_KEY = "booking_draft";

interface Draft {
  step: 1 | 2;
  day: string | null;
  slot: number | null;
  form: BookingFormState;
}

function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { step?: unknown; day?: unknown; slot?: unknown; form?: Record<string, unknown> };
    const slot = typeof saved.slot === "number" && saved.slot > Date.now() ? saved.slot : null;
    const field = (key: keyof BookingFormState) => (typeof saved.form?.[key] === "string" ? (saved.form[key] as string) : "");
    return {
      step: saved.step === 2 && slot !== null ? 2 : 1,
      day: typeof saved.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(saved.day) ? saved.day : null,
      slot,
      form: {
        name: field("name"),
        email: field("email"),
        company: field("company"),
        role: field("role"),
        phone: field("phone"),
        message: field("message"),
        // The business declaration is never pre-ticked, like the registration form's consent checkboxes.
        business: false,
      },
    };
  } catch {
    return null;
  }
}

/** /book-a-call and /prendre-rendez-vous: pick a free slot, say who you are, get the confirmation. */
export default function BookCall() {
  const lang = useSchoolLang();
  const t = BOOKING_TEXT[lang];
  const location = useLocation();
  const timeZone = useMemo(visitorTimeZone, []);
  const cycle = useMemo(() => hourCycle(lang), [lang]);
  const [draft] = useState(readDraft);
  const [step, setStep] = useState<Step>(draft?.step ?? 1);
  const [day, setDay] = useState<string | null>(draft?.day ?? null);
  const [slot, setSlot] = useState<number | null>(draft?.slot ?? null);
  const [notice, setNotice] = useState("");
  const [needTime, setNeedTime] = useState(false);
  const [form, setForm] = useState<BookingFormState>(draft?.form ?? EMPTY_FORM);
  const [booked, setBooked] = useState<{ number: string; start: number } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    try {
      if (step === 3) sessionStorage.removeItem(DRAFT_KEY);
      else sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step, day, slot, form }));
    } catch {
      /* storage unavailable: the page works without the draft */
    }
  }, [step, day, slot, form]);

  // Always fresh: the server is the only source of free slots.
  const slots = useQuery({
    queryKey: ["booking", "slots"],
    queryFn: fetchSlots,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    retry: 1,
  });
  const free = slots.data?.slots;
  const durationMinutes = slots.data?.durationMinutes ?? 30;

  // First day with a free slot preselected; a day emptied by a refresh is replaced the same way. A chosen time that
  // is no longer free is dropped on step 1 only: on step 2 the server answers 409 and sends the visitor back here.
  useEffect(() => {
    if (!free || step !== 1) return;
    const days = new Set(free.map((s) => dateKey(s, timeZone)));
    if (!day || !days.has(day)) setDay(free.length ? dateKey(free[0], timeZone) : null);
    if (slot !== null && !free.includes(slot)) setSlot(null);
  }, [free, timeZone, day, slot, step]);

  // Each step change moves the focus to the step's heading (screen readers announce it).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const goToForm = () => {
    if (slot === null) return setNeedTime(true);
    setNeedTime(false);
    setNotice("");
    setStep(2);
  };

  const slotUnavailable = (reason: "taken" | "gone") => {
    setNotice(reason === "taken" ? t.slotTaken : t.slotGone);
    setSlot(null);
    setStep(1);
    slots.refetch();
  };

  const heading = (text: string) => (
    <h2
      ref={headingRef}
      tabIndex={-1}
      className="scroll-mt-28 font-heading text-2xl font-bold mb-5 focus:outline-none"
      style={{ color: "#1F3B36" }}
    >
      {text}
    </h2>
  );

  return (
    <>
      <Seo
        title={t.seoTitle}
        description={t.seoDescription}
        path={SCHOOL_PATHS[lang].book}
        lang={lang}
        alternates={{ en: SCHOOL_PATHS.en.book, fr: SCHOOL_PATHS.fr.book }}
      />

      <section className="px-6 pb-12 pt-32 lg:px-12" style={{ background: "#FBF7F0" }}>
        <div className="mx-auto max-w-3xl">
          <p className="mb-4 font-heading text-sm font-bold" style={{ color: "#305D55" }}>
            {t.eyebrow}
            <Link
              to={alternateSchoolPath(location.pathname) + location.search}
              lang={lang === "fr" ? "en" : "fr"}
              className="ml-3 text-xs font-semibold underline"
              style={{ color: "#4B5B58" }}
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
          <div className="mt-6 flex items-start gap-3 rounded-md p-3.5 text-sm leading-relaxed" style={INFO_BOX}>
            <GraduationCap className="mt-0.5 size-5 shrink-0" style={{ color: "#305D55" }} aria-hidden="true" />
            <p>
              {t.studentsBefore}
              <Link to={SCHOOL_PATHS[lang].home} className="font-semibold underline" style={{ color: "#305D55" }}>
                {t.studentsLink}
              </Link>
            </p>
          </div>
        </div>
      </section>

      <section className="px-6 py-12 lg:px-12">
        <div className="mx-auto max-w-3xl">
          <ol aria-label={t.stepsLabel} className="mb-8 grid grid-cols-3 gap-2">
            {t.steps.map((label, i) => {
              const n = (i + 1) as Step;
              const current = step === n;
              const done = step > n;
              return (
                <li
                  key={label}
                  aria-current={current ? "step" : undefined}
                  className="flex items-center gap-2 border-t-[3px] pt-2.5 text-xs font-semibold sm:text-sm"
                  style={{ borderColor: current || done ? "#305D55" : "#ECE5D9", color: current ? "#1F3B36" : "#6B7672" }}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-6 shrink-0 items-center justify-center rounded-full text-[11px]"
                    style={current || done ? { background: "#305D55", color: "#FFFFFF" } : { background: "#F5EFE5", color: "#4B5B58" }}
                  >
                    {n}
                  </span>
                  <span className="sr-only">{t.stepOf(n, 3)}</span>
                  {label}
                </li>
              );
            })}
          </ol>

          {step === 1 && (
            <div>
              {heading(t.slot.title)}
              {notice && (
                <div role="alert" className="mb-6 rounded-md p-3 text-sm" style={ERROR_BOX}>
                  {notice}
                </div>
              )}
              {slots.isLoading ? (
                <p role="status" className="text-sm" style={{ color: "#6B7672" }}>
                  {t.slot.loading}
                </p>
              ) : slots.isError || !slots.data ? (
                <div role="alert" className="rounded-md p-4 text-sm" style={ERROR_BOX}>
                  <p>{t.slot.loadError}</p>
                  <button type="button" onClick={() => slots.refetch()} className={`${secondaryButton} mt-3`} style={SECONDARY_STYLE}>
                    {t.slot.retry}
                  </button>
                </div>
              ) : slots.data.slots.length === 0 ? (
                <div className="rounded-md p-4 text-sm leading-relaxed" style={INFO_BOX}>
                  <p>{t.slot.none}</p>
                  <Link to={`${SCHOOL_PATHS[lang].help}?topic=other`} className="mt-2 inline-block font-semibold underline" style={{ color: "#305D55" }}>
                    {t.slot.helpLink}
                  </Link>
                </div>
              ) : (
                // A form, so that Enter on a chosen time continues like the button.
                <form
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    goToForm();
                  }}
                >
                  <SlotPicker
                    lang={lang}
                    timeZone={timeZone}
                    cycle={cycle}
                    slots={slots.data.slots}
                    now={slots.data.now}
                    horizonDays={slots.data.horizonDays}
                    day={day}
                    onDay={(d) => {
                      setDay(d);
                      setSlot(null);
                    }}
                    slot={slot}
                    onSlot={(s) => {
                      setSlot(s);
                      setNeedTime(false);
                    }}
                  />
                  <div className="mt-8">
                    {needTime && (
                      <p role="alert" className="mb-3 text-sm" style={{ color: "#B91C1C" }}>
                        {t.slot.needTime}
                      </p>
                    )}
                    <button type="submit" className={primaryButton} style={PRIMARY_STYLE}>
                      {t.slot.continue}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {step === 2 && slot !== null && (
            <div>
              {heading(t.form.title)}
              <BookingForm
                lang={lang}
                value={form}
                onChange={setForm}
                start={slot}
                durationMinutes={durationMinutes}
                timeZone={timeZone}
                cycle={cycle}
                onChangeTime={() => {
                  setStep(1);
                  slots.refetch();
                }}
                onBooked={(number, start) => {
                  setBooked({ number, start });
                  setStep(3);
                }}
                onSlotUnavailable={slotUnavailable}
              />
            </div>
          )}

          {step === 3 && booked && (
            <div>
              {heading(t.done.title)}
              <BookingDone
                lang={lang}
                number={booked.number}
                start={booked.start}
                durationMinutes={durationMinutes}
                timeZone={timeZone}
                cycle={cycle}
              />
            </div>
          )}
        </div>
      </section>
    </>
  );
}
