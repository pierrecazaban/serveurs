import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, CircleCheck, Download, ExternalLink } from "lucide-react";
import type { SchoolLang } from "@/lib/school/lang";
import { BOOKING_TEXT } from "@/lib/booking/text";
import { bookingIcs, googleCalendarUrl } from "@/lib/booking/ics";
import { describeCall } from "@/lib/booking/time";
import { PRIMARY_STYLE, SECONDARY_STYLE, primaryButton, secondaryButton } from "./styles";

/** Step 3: the booked call in the visitor's zone, its number, "Add to calendar", what comes next and how to cancel. */
export function BookingDone({
  lang,
  number,
  start,
  durationMinutes,
  timeZone,
  cycle,
}: {
  lang: SchoolLang;
  number: string;
  start: number;
  durationMinutes: number;
  timeZone: string;
  cycle: "h12" | "h23";
}) {
  const t = BOOKING_TEXT[lang].done;
  const parisLong = BOOKING_TEXT[lang].slot.parisLong;
  const call = describeCall(start, durationMinutes, timeZone, lang, cycle);
  const event = { number, start, durationMinutes, lang };
  const icsUrl = useMemo(
    () => URL.createObjectURL(new Blob([bookingIcs({ number, start, durationMinutes, lang })], { type: "text/calendar;charset=utf-8" })),
    [number, start, durationMinutes, lang],
  );
  useEffect(() => () => URL.revokeObjectURL(icsUrl), [icsUrl]);

  const h3 = "font-heading text-base font-bold mb-1.5";
  return (
    <div className="space-y-7">
      <div className="border bg-white p-5 sm:p-7" style={{ borderColor: "#E3EDE7" }}>
        <span className="mb-4 flex size-11 items-center justify-center rounded-full" style={{ background: "#305D55" }}>
          <CircleCheck className="size-6 text-white" aria-hidden="true" />
        </span>
        <p className="text-base font-semibold" style={{ color: "#1F3B36" }}>
          {call.local.date}
        </p>
        <p className="text-base" style={{ color: "#1F3B36" }}>
          {call.local.range} <span style={{ color: "#4B5B58" }}>({timeZone})</span>
        </p>
        {call.paris && (
          <p className="mt-1 text-sm" style={{ color: "#4B5B58" }}>
            {parisLong(call.paris.date === call.local.date ? call.paris.range : `${call.paris.date}, ${call.paris.range}`)}
          </p>
        )}
        <p className="mt-4 text-sm" style={{ color: "#4B5B58" }}>
          {t.number}
          {lang === "fr" ? " : " : ": "}
          <strong className="font-mono text-base" style={{ color: "#1F3B36" }}>
            {number}
          </strong>
        </p>
        <p className="mt-1 text-xs" style={{ color: "#6B7672" }}>
          {t.keep}
        </p>
      </div>

      <section aria-labelledby="booking-add">
        <h3 id="booking-add" className={h3} style={{ color: "#1F3B36" }}>
          {t.addTitle}
        </h3>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <a href={icsUrl} download={`reetma-call-${number}.ics`} className={primaryButton} style={PRIMARY_STYLE}>
            <Download className="size-4" aria-hidden="true" />
            {t.ics}
          </a>
          <a
            href={googleCalendarUrl(event)}
            target="_blank"
            rel="noopener noreferrer"
            className={secondaryButton}
            style={SECONDARY_STYLE}
          >
            <CalendarPlus className="size-4" aria-hidden="true" />
            {t.google}
            <ExternalLink className="size-3.5 opacity-70" aria-hidden="true" />
            <span className="sr-only">{t.newTab}</span>
          </a>
        </div>
      </section>

      <section aria-labelledby="booking-next">
        <h3 id="booking-next" className={h3} style={{ color: "#1F3B36" }}>
          {t.nextTitle}
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
          {t.next}
        </p>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
          {t.emailNote}
        </p>
      </section>

      <section aria-labelledby="booking-cancel">
        <h3 id="booking-cancel" className={h3} style={{ color: "#1F3B36" }}>
          {t.cancelTitle}
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
          {t.cancel}
        </p>
      </section>

      <Link to="/" className="inline-block text-sm font-semibold underline" style={{ color: "#305D55" }}>
        {t.home}
      </Link>
    </div>
  );
}
