// Calls booked from /book-a-call and /prendre-rendez-vous: opening hours, free slots, cancel links, calendar file.
// Pure functions only (no database, no network); the request handlers are in api/_bookingApi.js.
// Every time is computed with the Intl API in Paris wall-clock time, so summer/winter time changes are handled.
import crypto from "node:crypto";

/**
 * The calendar's opening hours: change them here.
 * Days off: add Paris dates to blockedDates, e.g. ["2026-12-24", "2026-12-31"].
 * No length is stored per call: the calls already booked are taken to last durationMinutes too. Moving the hours or
 * lengthening the calls never offers a time that overlaps them; shorten durationMinutes only once no call booked with
 * the longer duration is still upcoming.
 */
export const BOOKING = {
  timezone: "Europe/Paris", // the hours below are wall-clock times in this zone
  weekdays: [1, 2, 3, 4, 5], // 1 = Monday … 7 = Sunday
  windows: [
    ["09:00", "12:00"],
    ["14:00", "18:00"],
  ],
  durationMinutes: 30, // every call, the ones already booked included (see above before shortening it)
  minNoticeHours: 24,
  horizonDays: 21, // bookable up to this many days after today (Paris date)
  frenchHolidays: true, // 1 Jan, Easter Monday, 1 May, 8 May, Ascension, Whit Monday, 14 Jul, 15 Aug, 1 Nov, 11 Nov, 25 Dec
  blockedDates: [],
};

// ---- Time zones (Intl only) ----
const formatters = new Map();
function partsFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
  }
  return formatters.get(timeZone);
}

/** Wall-clock date and time of an instant in a time zone. */
export function zonedParts(ms, timeZone) {
  const v = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(ms))) if (p.type !== "literal") v[p.type] = Number(p.value);
  return { y: v.year, m: v.month, d: v.day, h: v.hour % 24, min: v.minute, s: v.second };
}

const offsetAt = (ms, timeZone) => {
  const p = zonedParts(ms, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ms / 1000) * 1000;
};

/** The instant (ms) of a wall-clock date and time in a time zone. */
export function wallTimeToUtc(y, m, d, h, min, timeZone) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = guess - offsetAt(guess, timeZone);
  // Second pass: the offset at the result may differ from the one at the guess (summer/winter time change).
  return guess - offsetAt(first, timeZone);
}

const pad = (n) => String(n).padStart(2, "0");
const dateKey = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Old names of a few zones that browsers still report (Chrome gives "Asia/Calcutta" for Asia/Kolkata, "Europe/Kiev"
// for Europe/Kyiv): stored, shown and emailed under their current IANA name. Same list as src/lib/booking/time.ts.
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

/**
 * The IANA time zone the browser sent, when Intl knows it (under its current name: Asia/Kolkata, not Asia/Calcutta);
 * Paris when it is missing or unknown.
 */
export function validTimeZone(tz) {
  if (typeof tz !== "string" || tz.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(tz)) return BOOKING.timezone;
  for (const name of [CURRENT_ZONE_NAMES.get(tz), tz]) {
    if (!name) continue;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: name });
      return name;
    } catch {
      /* unknown to this Intl: try the name as sent, then fall back to Paris */
    }
  }
  return BOOKING.timezone;
}

// ---- French public holidays ----
/** Easter Sunday (Gregorian calendar, anonymous algorithm): { m, d }. */
export function easterSunday(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return { m: month, d: ((h + l - 7 * m + 114) % 31) + 1 };
}

const holidayCache = new Map();
/** Public holidays in France for a year, as "YYYY-MM-DD". */
export function frenchHolidays(y) {
  if (!holidayCache.has(y)) {
    const easter = easterSunday(y);
    const fromEaster = (days) => {
      const t = new Date(Date.UTC(y, easter.m - 1, easter.d + days));
      return dateKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    };
    holidayCache.set(
      y,
      new Set([
        `${y}-01-01`,
        fromEaster(1), // Easter Monday
        `${y}-05-01`,
        `${y}-05-08`,
        fromEaster(39), // Ascension
        fromEaster(50), // Whit Monday
        `${y}-07-14`,
        `${y}-08-15`,
        `${y}-11-01`,
        `${y}-11-11`,
        `${y}-12-25`,
      ]),
    );
  }
  return holidayCache.get(y);
}

// ---- Slots ----
const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Start (ms) of every slot the calendar offers at `now`, booked or not, in chronological order:
 * opening days and hours in Paris time, at least `minNoticeHours` ahead, up to `horizonDays` after today.
 */
export function candidateSlots(now = Date.now(), cfg = BOOKING) {
  const today = zonedParts(now, cfg.timezone);
  const earliest = now + cfg.minNoticeHours * 3600e3;
  const out = [];
  for (let i = 0; i <= cfg.horizonDays; i += 1) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const key = dateKey(y, m, d);
    if (!cfg.weekdays.includes(day.getUTCDay() || 7)) continue;
    if (cfg.blockedDates.includes(key)) continue;
    if (cfg.frenchHolidays && frenchHolidays(y).has(key)) continue;
    for (const [from, to] of cfg.windows) {
      for (let t = minutesOf(from); t + cfg.durationMinutes <= minutesOf(to); t += cfg.durationMinutes) {
        const start = wallTimeToUtc(y, m, d, Math.floor(t / 60), t % 60, cfg.timezone);
        if (start >= earliest) out.push(start);
      }
    }
  }
  return out;
}

/** A slot start sent by the browser (ISO 8601 in UTC) → ms, or null. */
export function parseSlot(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export const iso = (ms) => new Date(ms).toISOString();

// ---- Cancel links: "<id>.<number>.<HMAC-SHA256>", signed with SESSION_SECRET like the links of api/_auth.js ----
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw Object.assign(new Error("SESSION_SECRET is not configured"), { code: "no_secret" });
  return s;
}

const mac = (id, number) => crypto.createHmac("sha256", secret()).update(`reetma-call-cancel:${id}:${number}`).digest("base64url");

export function cancelToken(ticket) {
  return `${ticket.id}.${ticket.number}.${mac(ticket.id, ticket.number)}`;
}

/** { id, number } of a valid cancel token (a string), or null (timing-safe comparison). */
export function readCancelToken(token) {
  if (typeof token !== "string") return null;
  const match = /^(\d{1,18})\.(T-[A-Z0-9]{6})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  const [, id, number, given] = match;
  const expected = Buffer.from(mac(id, number));
  if (!crypto.timingSafeEqual(expected, Buffer.from(given))) return null;
  return { id, number };
}

// ---- Dates for people ----
const LOCALES = { en: "en-US", fr: "fr-FR" };

/**
 * Date and times of a call for an email, in the booker's zone and in Paris time:
 * { timeZone, local: { date, day, time, range }, paris: same shape, or null when the wall-clock time is the same }.
 */
export function describeCall(startMs, timeZone, lang) {
  const locale = LOCALES[lang] ?? LOCALES.en;
  const end = startMs + BOOKING.durationMinutes * 60e3;
  const fmt = (zone, options) => new Intl.DateTimeFormat(locale, { ...options, timeZone: zone });
  const at = (zone) => {
    const time = (ms) => fmt(zone, { hour: "numeric", minute: "2-digit" }).format(ms);
    return {
      date: fmt(zone, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(startMs),
      day: fmt(zone, { weekday: "long", day: "numeric", month: "long" }).format(startMs),
      time: time(startMs),
      range: `${time(startMs)} – ${time(end)}`,
    };
  };
  const local = at(timeZone);
  const paris = at(BOOKING.timezone);
  const sameWallTime = local.date === paris.date && local.range === paris.range;
  return { timeZone, local, paris: sameWallTime ? null : paris };
}

// ---- Calendar file (RFC 5545) ----
const icsText = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsTime = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// Lines longer than 75 octets are folded (CRLF + one space), never inside a UTF-8 character.
function fold(line) {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const out = [];
  let current = "";
  let size = 0;
  let limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    if (size + n > limit) {
      out.push(current);
      current = "";
      size = 0;
      limit = 74; // the leading space of a continuation line counts
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

const ICS_TEXT = {
  en: {
    summary: "Call with Reetma",
    location: "Video call (link sent by email)",
    description: (number) =>
      `Booking ${number}. We'll email you the video-call link before the call. To cancel or reschedule, use the link in your confirmation email.`,
  },
  fr: {
    summary: "Appel avec Reetma",
    location: "Visioconférence (lien envoyé par e-mail)",
    description: (number) =>
      `Réservation ${number}. Nous vous enverrons le lien de la visioconférence par e-mail avant l'appel. Pour annuler ou déplacer le rendez-vous, utilisez le lien de l'e-mail de confirmation.`,
  },
};

/** The .ics invitation of a booking (same content as src/lib/booking/ics.ts, which the confirmation page downloads). */
export function bookingIcs({ number, start, lang, stamp = Date.now() }) {
  const t = ICS_TEXT[lang] ?? ICS_TEXT.en;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Reetma//Call booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${number}@reetma-agency.com`,
    `DTSTAMP:${icsTime(stamp)}`,
    "ORGANIZER;CN=Reetma:mailto:no-reply@reetma-agency.com",
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(start + BOOKING.durationMinutes * 60e3)}`,
    `SUMMARY:${icsText(t.summary)}`,
    `DESCRIPTION:${icsText(t.description(number))}`,
    `LOCATION:${icsText(t.location)}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** "Add to Google Calendar" link of a booking. */
export function googleCalendarUrl({ number, start, lang }) {
  const t = ICS_TEXT[lang] ?? ICS_TEXT.en;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: t.summary,
    dates: `${icsTime(start)}/${icsTime(start + BOOKING.durationMinutes * 60e3)}`,
    details: t.description(number),
    location: t.location,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
