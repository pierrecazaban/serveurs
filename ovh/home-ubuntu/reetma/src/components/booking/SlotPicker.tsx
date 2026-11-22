import { useMemo } from "react";
import { Globe2 } from "lucide-react";
import type { SchoolLang } from "@/lib/school/lang";
import { BOOKING_TEXT } from "@/lib/booking/text";
import { PARIS, dateKey, dayLabels, dayList, formatTime, formatWeekday, isoWeekday, weekdayHeaders } from "@/lib/booking/time";

/** Slots grouped by day ("YYYY-MM-DD") in the visitor's zone. */
function slotsByDay(slots: number[], timeZone: string): Map<string, number[]> {
  const days = new Map<string, number[]>();
  for (const s of slots) {
    const key = dateKey(s, timeZone);
    if (!days.has(key)) days.set(key, []);
    days.get(key)!.push(s);
  }
  return days;
}

// Windows contrast themes (forced colors) replace the pills' colors and drop the focus ring (a box-shadow), so the
// chosen pill, the unavailable days and the keyboard focus are marked with system colors, which that mode keeps.
// The chosen pill opts out of the forced text backplate (Canvas behind HighlightText would hide its label), and the
// outline color is explicit (by default it would be the chosen pill's HighlightText, invisible on Canvas).
const FORCED_COLORS =
  "forced-colors:peer-checked:forced-color-adjust-none forced-colors:peer-checked:border-[color:Highlight] forced-colors:peer-checked:bg-[color:Highlight] forced-colors:peer-checked:text-[color:HighlightText] forced-colors:peer-disabled:border-[color:Canvas] forced-colors:peer-disabled:text-[color:GrayText] forced-colors:peer-focus-visible:outline forced-colors:peer-focus-visible:outline-2 forced-colors:peer-focus-visible:outline-offset-2 forced-colors:peer-focus-visible:outline-[color:CanvasText]";

/**
 * Step 1: a day among the days the server offers (days without a free slot are disabled), then a time. Both are native
 * radio groups: arrow keys move between the choices, screen readers announce each day's number of free times.
 */
export function SlotPicker({
  lang,
  timeZone,
  cycle,
  slots,
  now,
  horizonDays,
  day,
  onDay,
  slot,
  onSlot,
}: {
  lang: SchoolLang;
  timeZone: string;
  cycle: "h12" | "h23";
  slots: number[];
  /** The server's time (today's date for the grid). */
  now: number;
  /** Days after today that the grid shows (BOOKING.horizonDays, sent with the slots). */
  horizonDays: number;
  day: string | null;
  onDay: (day: string) => void;
  slot: number | null;
  onSlot: (slot: number) => void;
}) {
  const t = BOOKING_TEXT[lang].slot;
  const byDay = useMemo(() => slotsByDay(slots, timeZone), [slots, timeZone]);
  const days = useMemo(() => dayList(slots, timeZone, now, horizonDays), [slots, timeZone, now, horizonDays]);
  const lead = days.length ? isoWeekday(days[0]) - 1 : 0; // empty cells before the first day, Monday first
  const times = day ? (byDay.get(day) ?? []) : [];
  const parisDiffers = slots.some((s) => formatTime(s, timeZone, lang, cycle) !== formatTime(s, PARIS, lang, cycle));

  return (
    <div className="space-y-7">
      <div className="flex items-start gap-2 text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
        <Globe2 className="mt-0.5 size-4 shrink-0" style={{ color: "#305D55" }} aria-hidden="true" />
        <p>
          {t.timeZone}
          <strong className="break-all" style={{ color: "#1F3B36" }}>
            {timeZone}
          </strong>
          {parisDiffers && (
            <span className="mt-1 block text-xs" style={{ color: "#6B7672" }}>
              {t.parisNote}
            </span>
          )}
        </p>
      </div>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold" style={{ color: "#1F3B36" }}>
          {t.dayLegend}
        </legend>
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {weekdayHeaders(lang).map((h) => (
            <span
              key={h}
              aria-hidden="true"
              className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: "#4B5B58" }}
            >
              {h}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`lead-${i}`} aria-hidden="true" />
          ))}
          {days.map((key) => {
            const count = byDay.get(key)?.length ?? 0;
            const label = dayLabels(key, lang);
            return (
              <label key={key} className="block">
                <input
                  type="radio"
                  name="booking-day"
                  value={key}
                  checked={day === key}
                  disabled={!count}
                  onChange={() => onDay(key)}
                  aria-label={t.dayLabel(label.full, count)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className={`flex h-14 cursor-pointer flex-col items-center justify-center rounded-md border border-[#DDD5C7] bg-white text-[#1F3B36] transition-colors hover:border-[#305D55] peer-checked:border-[#305D55] peer-checked:bg-[#305D55] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-[#305D55] peer-focus-visible:ring-offset-2 peer-disabled:cursor-not-allowed peer-disabled:border-transparent peer-disabled:bg-transparent peer-disabled:text-[#B3BBB7] ${FORCED_COLORS}`}
                >
                  <span className="text-base font-semibold leading-none">{label.day}</span>
                  <span className="mt-1 text-[11px] leading-none">{label.month}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {day ? (
        <fieldset>
          <legend className="mb-3 text-sm font-semibold" style={{ color: "#1F3B36" }}>
            {t.timesLegend(dayLabels(day, lang).full)}
          </legend>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {times.map((s) => {
              const local = formatTime(s, timeZone, lang, cycle);
              const parisTime = formatTime(s, PARIS, lang, cycle);
              const differs = local !== parisTime;
              // Far from Paris the call can fall on another day there: the Paris time then names its day, short on the
              // pill ("Fri 4:00 PM") and in full for screen readers ("Friday 4:00 PM": "ven." would be read as a word).
              const sameDay = dateKey(s, PARIS) === day;
              const paris = sameDay ? parisTime : `${formatWeekday(s, PARIS, lang)} ${parisTime}`;
              const parisSpoken = sameDay ? parisTime : `${formatWeekday(s, PARIS, lang, "long")} ${parisTime}`;
              return (
                <label key={s} className="block">
                  <input
                    type="radio"
                    name="booking-time"
                    value={String(s)}
                    checked={slot === s}
                    onChange={() => onSlot(s)}
                    aria-label={differs ? `${local}, ${t.parisLong(parisSpoken)}` : local}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={`flex min-h-[3.25rem] cursor-pointer flex-col items-center justify-center rounded-md border border-[#DDD5C7] bg-white px-2 py-2 text-center text-[#1F3B36] transition-colors hover:border-[#305D55] peer-checked:border-[#305D55] peer-checked:bg-[#305D55] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-[#305D55] peer-focus-visible:ring-offset-2 ${FORCED_COLORS}`}
                  >
                    <span className="text-sm font-semibold leading-tight">{local}</span>
                    {differs && <span className="mt-0.5 text-[11px] leading-tight opacity-80">{t.paris(paris)}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : (
        <p className="text-sm" style={{ color: "#6B7672" }}>
          {t.pickDay}
        </p>
      )}
    </div>
  );
}
