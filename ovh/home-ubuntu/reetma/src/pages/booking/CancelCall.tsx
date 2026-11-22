import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { CalendarX2, CircleCheck } from "lucide-react";
import { Seo } from "@/components/Seo";
import { SCHOOL_PATHS, alternateSchoolPath, useSchoolLang } from "@/lib/school/lang";
import { BOOKING_TEXT } from "@/lib/booking/text";
import { cancelBooking, fetchBooking, type BookingInfo } from "@/lib/booking/api";
import { describeCall, hourCycle, visitorTimeZone } from "@/lib/booking/time";
import { ERROR_BOX, INFO_BOX, SECONDARY_STYLE, primaryButton, secondaryButton } from "@/components/booking/styles";

type State = "loading" | "ready" | "cancelling" | "cancelled" | "invalid" | "error" | "rate_limited";

/**
 * /book-a-call/cancel?t=… and /prendre-rendez-vous/annuler?t=…, the link of the confirmation email.
 * Opening it only shows the call (mail scanners open links): cancelling takes a click on the button.
 */
export default function CancelCall() {
  const lang = useSchoolLang();
  const t = BOOKING_TEXT[lang].cancelPage;
  const text = BOOKING_TEXT[lang];
  const location = useLocation();
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";
  const timeZone = useMemo(visitorTimeZone, []);
  const cycle = useMemo(() => hourCycle(lang), [lang]);
  const [state, setState] = useState<State>(token ? "loading" : "invalid");
  const [failure, setFailure] = useState("");
  const [booking, setBooking] = useState<BookingInfo | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return setState("invalid");
    let alive = true;
    setState("loading");
    fetchBooking(token).then((res) => {
      if (!alive) return;
      if ("booking" in res) {
        setBooking(res.booking);
        setState("ready");
      } else {
        setState(res.error);
      }
    });
    return () => {
      alive = false;
    };
  }, [token]);

  async function confirm() {
    setState("cancelling");
    setFailure("");
    const res = await cancelBooking(token);
    const error = "error" in res ? res.error : null;
    if (!error) {
      setState("cancelled");
    } else if (error === "already_cancelled" || error === "past") {
      setBooking((b) => (b ? { ...b, status: error === "past" ? "past" : "cancelled" } : b));
      setState("ready");
    } else if (error === "invalid") {
      setState("invalid");
    } else {
      setFailure(error === "rate_limited" ? t.rateLimited : t.error);
      setState("ready");
    }
    window.setTimeout(() => resultRef.current?.focus(), 0);
  }

  const call = booking ? describeCall(booking.start, booking.durationMinutes, timeZone, lang, cycle) : null;
  const rebook = (
    <Link to={SCHOOL_PATHS[lang].book} className={`${secondaryButton} mt-4`} style={SECONDARY_STYLE}>
      {t.rebook}
    </Link>
  );

  return (
    <>
      <Seo
        title={t.seoTitle}
        description={t.seoDescription}
        path={SCHOOL_PATHS[lang].bookCancel}
        lang={lang}
        alternates={{ en: SCHOOL_PATHS.en.bookCancel, fr: SCHOOL_PATHS.fr.bookCancel }}
        noindex
      />
      <section className="px-6 pb-20 pt-32 lg:px-12" style={{ background: "#FBF7F0" }}>
        <div className="mx-auto max-w-2xl">
          <p className="mb-4 font-heading text-sm font-bold" style={{ color: "#305D55" }}>
            {text.eyebrow}
            <Link
              to={alternateSchoolPath(location.pathname) + location.search}
              lang={lang === "fr" ? "en" : "fr"}
              className="ml-3 text-xs font-semibold underline"
              style={{ color: "#4B5B58" }}
            >
              {text.switchLabel}
            </Link>
          </p>
          <h1 className="font-heading text-3xl font-bold mb-8 sm:text-4xl" style={{ color: "#1F3B36" }}>
            {t.title}
          </h1>

          <div ref={resultRef} tabIndex={-1} className="focus:outline-none">
            {state === "loading" && (
              <p role="status" className="text-sm" style={{ color: "#6B7672" }}>
                {t.loading}
              </p>
            )}

            {state === "invalid" && (
              <div className="rounded-md p-4 text-sm leading-relaxed" style={ERROR_BOX}>
                <p>{t.invalid}</p>
                <Link to={SCHOOL_PATHS[lang].help} className="mt-2 inline-block font-semibold underline">
                  {t.helpLink}
                </Link>
              </div>
            )}

            {(state === "error" || state === "rate_limited") && (
              <div className="rounded-md p-4 text-sm" style={ERROR_BOX}>
                <p>{state === "rate_limited" ? t.rateLimited : t.error}</p>
              </div>
            )}

            {state === "cancelled" && (
              <div className="border bg-white p-6 sm:p-7" style={{ borderColor: "#E3EDE7" }}>
                <span className="mb-4 flex size-11 items-center justify-center rounded-full" style={{ background: "#305D55" }}>
                  <CircleCheck className="size-6 text-white" aria-hidden="true" />
                </span>
                <p className="font-heading text-xl font-bold mb-2" style={{ color: "#1F3B36" }}>
                  {t.cancelledTitle}
                </p>
                <p className="text-sm" style={{ color: "#4B5B58" }}>
                  {t.cancelledBody}
                </p>
                {rebook}
              </div>
            )}

            {(state === "ready" || state === "cancelling") && booking && call && (
              <div className="border bg-white p-6 sm:p-7" style={{ borderColor: "#ECE5D9" }}>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#6B7672" }}>
                  {t.yourCall}
                </p>
                <p className="mt-2 text-base font-semibold" style={{ color: "#1F3B36" }}>
                  {call.local.date}
                </p>
                <p className="text-base" style={{ color: "#1F3B36" }}>
                  {call.local.range} <span style={{ color: "#4B5B58" }}>({timeZone})</span>
                </p>
                {call.paris && (
                  <p className="mt-1 text-sm" style={{ color: "#4B5B58" }}>
                    {text.slot.parisLong(call.paris.date === call.local.date ? call.paris.range : `${call.paris.date}, ${call.paris.range}`)}
                  </p>
                )}
                <p className="mt-3 text-sm" style={{ color: "#4B5B58" }}>
                  {t.number}
                  {lang === "fr" ? " : " : ": "}
                  <strong className="font-mono" style={{ color: "#1F3B36" }}>
                    {booking.number}
                  </strong>
                </p>

                {booking.status === "upcoming" ? (
                  <div className="mt-6 border-t pt-5" style={{ borderColor: "#ECE5D9" }}>
                    {failure && (
                      <p role="alert" className="mb-4 rounded-md p-3 text-sm" style={ERROR_BOX}>
                        {failure}
                      </p>
                    )}
                    <p className="text-sm leading-relaxed" style={{ color: "#3A4F4A" }}>
                      {t.question}
                    </p>
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                      <button
                        type="button"
                        onClick={confirm}
                        disabled={state === "cancelling"}
                        className={primaryButton}
                        style={{ background: "#B91C1C" }}
                      >
                        <CalendarX2 className="size-4" aria-hidden="true" />
                        {state === "cancelling" ? t.cancelling : t.confirm}
                      </button>
                      <Link to="/" className="text-sm font-semibold underline" style={{ color: "#305D55" }}>
                        {t.keep}
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 rounded-md p-4 text-sm leading-relaxed" style={INFO_BOX}>
                    <p>{booking.status === "cancelled" ? t.alreadyCancelled : t.past}</p>
                    {rebook}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
