// "Add to calendar" for a booked call: the .ics file (RFC 5545) and the Google Calendar link.
// Same content as the invitation attached to the confirmation email (api/_booking.js), same UID: importing both
// gives a single event.
import type { SchoolLang } from "@/lib/school/lang";

const TEXT: Record<SchoolLang, { summary: string; location: string; description: (n: string) => string }> = {
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

const encoder = new TextEncoder();
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsTime = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// Lines longer than 75 octets are folded (CRLF + one space), never inside a UTF-8 character.
function fold(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  let limit = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
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

export interface CallEvent {
  number: string;
  start: number;
  durationMinutes: number;
  lang: SchoolLang;
}

export function bookingIcs({ number, start, durationMinutes, lang }: CallEvent, stamp = Date.now()): string {
  const t = TEXT[lang];
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
    `DTEND:${icsTime(start + durationMinutes * 60e3)}`,
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

export function googleCalendarUrl({ number, start, durationMinutes, lang }: CallEvent): string {
  const t = TEXT[lang];
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: t.summary,
    dates: `${icsTime(start)}/${icsTime(start + durationMinutes * 60e3)}`,
    details: t.description(number),
    location: t.location,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
