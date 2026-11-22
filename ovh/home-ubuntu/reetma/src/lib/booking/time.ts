// Times of the booking calendar in the visitor's own time zone, with the Intl API only (no time-zone library).
// The server sends slot starts in UTC; everything here is display.
import type { SchoolLang } from "@/lib/school/lang";

export const PARIS = "Europe/Paris";
const LOCALES: Record<SchoolLang, string> = { en: "en-US", fr: "fr-FR" };

// Old names of a few zones that browsers still report (Chrome gives "Asia/Calcutta" for Asia/Kolkata, "Europe/Kiev"
// for Europe/Kyiv): shown and sent under their current IANA name. Same list as api/_booking.js.
const CURRENT_ZONE_NAMES = new Map([
  ["Asia/Calcutta", "Asia/Kolkata"], ["Europe/Kiev", "Europe/Kyiv"], ["Asia/Saigon", "Asia/Ho_Chi_Minh"],
  ["Asia/Katmandu", "Asia/Kathmandu"], ["Asia/Rangoon", "Asia/Yangon"], ["America/Godthab", "America/Nuuk"],
  ["Pacific/Enderbury", "Pacific/Kanton"], ["Atlantic/Faeroe", "Atlantic/Faroe"], ["Africa/Asmera", "Africa/Asmara"],
  ["Pacific/Truk", "Pacific/Chuuk"], ["Pacific/Ponape", "Pacific/Pohnpei"], ["America/Coral_Harbour", "America/Atikokan"],
  ["America/Buenos_Aires", "America/Argentina/Buenos_Aires"], ["America/Catamarca", "America/Argentina/Catamarca"],
  ["America/Cordoba", "America/Argentina/Cordoba"], ["America/Jujuy", "America/Argentina/Jujuy"],
  ["America/Mendoza", "America/Argentina/Mendoza"], ["America/Indianapolis", "America/Indiana/Indianapolis"],
  ["America/Louisville", "America/Kentucky/Louisville"],
]);

/** The visitor's IANA time zone (under its current name), or Paris when the browser gives none or an unknown one. */
export function visitorTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    for (const name of [CURRENT_ZONE_NAMES.get(tz), tz]) {
      if (!name) continue;
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: name }); // throws on an unknown zone
        return name;
      } catch {
        /* unknown to this browser: try the name it gave */
      }
    }
  } catch {
    /* no zone: fall back to Paris */
  }
  return PARIS;
}

/** 24-hour clock on French pages; on English pages, the visitor's habit (en-GB → 14:00, en-US → 2:00 PM). */
export function hourCycle(lang: SchoolLang): "h12" | "h23" {
  if (lang === "fr") return "h23";
  try {
    const options = new Intl.DateTimeFormat(navigator.language || "en-US", { hour: "numeric" }).resolvedOptions();
    const hc = (options as { hourCycle?: string }).hourCycle;
    return hc === "h23" || hc === "h24" ? "h23" : "h12";
  } catch {
    return "h12";
  }
}

/** "YYYY-MM-DD" of an instant in a time zone. */
export function dateKey(ms: number, timeZone: string): string {
  const v: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ms)) {
    v[p.type] = p.value;
  }
  return `${v.year}-${v.month}-${v.day}`;
}

/** Noon UTC of a "YYYY-MM-DD" date: formatting it in UTC always gives that date back. */
const noonOf = (key: string) => Date.parse(`${key}T12:00:00Z`);

export function addDays(key: string, days: number): string {
  return new Date(noonOf(key) + days * 86400e3).toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday. */
export const isoWeekday = (key: string) => new Date(noonOf(key)).getUTCDay() || 7;

const daysBetween = (from: string, to: string) => Math.round((noonOf(to) - noonOf(from)) / 86400e3);

/**
 * The days the visitor can pick from, in their zone, every date from the first to the last (the grid puts each one
 * under its weekday, so none may be missing): the `days` days after today, stretched to the days the slots fall on
 * (a zone far from Paris can push the last slots one day further). `now` is the server's time when known.
 */
export function dayList(slots: number[], timeZone: string, now: number, days: number): string[] {
  const keys = slots.map((s) => dateKey(s, timeZone)).sort();
  const today = dateKey(now, timeZone);
  let first = addDays(today, 1);
  let last = addDays(today, days);
  if (keys.length) {
    if (keys[0] < first) first = keys[0];
    if (keys[keys.length - 1] > last) last = keys[keys.length - 1];
    // A clock a week or more off (no server time and a wrong device clock): the slots alone set the range.
    if (daysBetween(first, last) > days + 7) {
      first = keys[0];
      last = keys[keys.length - 1] > addDays(first, days - 1) ? keys[keys.length - 1] : addDays(first, days - 1);
    }
  }
  const out: string[] = [];
  for (let key = first; key <= last; key = addDays(key, 1)) out.push(key);
  return out;
}

/** Labels of a day ("YYYY-MM-DD") of the picker. */
export function dayLabels(key: string, lang: SchoolLang) {
  const f = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(LOCALES[lang], { ...options, timeZone: "UTC" }).format(noonOf(key));
  return {
    weekday: f({ weekday: "short" }),
    day: f({ day: "numeric" }),
    month: f({ month: "short" }),
    full: f({ weekday: "long", day: "numeric", month: "long" }),
  };
}

/** Short weekday names, Monday first, for the picker's column headers. */
export function weekdayHeaders(lang: SchoolLang): string[] {
  // 2026-11-02 is a Monday.
  return Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(LOCALES[lang], { weekday: "short", timeZone: "UTC" }).format(noonOf(addDays("2026-11-02", i))),
  );
}

/** Weekday of an instant in a time zone: short ("Fri", "ven.") or long ("Friday", "vendredi"). */
export function formatWeekday(ms: number, timeZone: string, lang: SchoolLang, style: "short" | "long" = "short"): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { weekday: style, timeZone }).format(ms);
}

export function formatTime(ms: number, timeZone: string, lang: SchoolLang, cycle: "h12" | "h23"): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { hour: "numeric", minute: "2-digit", hourCycle: cycle, timeZone }).format(ms);
}

export function formatDate(ms: number, timeZone: string, lang: SchoolLang): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).format(ms);
}

/**
 * A call's date and times for people: in the visitor's zone, and in Paris time when the wall-clock time there
 * differs (paris is null otherwise).
 */
export function describeCall(start: number, durationMinutes: number, timeZone: string, lang: SchoolLang, cycle: "h12" | "h23") {
  const end = start + durationMinutes * 60e3;
  const at = (zone: string) => ({
    date: formatDate(start, zone, lang),
    time: formatTime(start, zone, lang, cycle),
    range: `${formatTime(start, zone, lang, cycle)} – ${formatTime(end, zone, lang, cycle)}`,
  });
  const local = at(timeZone);
  const paris = at(PARIS);
  return { local, paris: local.date === paris.date && local.range === paris.range ? null : paris };
}
