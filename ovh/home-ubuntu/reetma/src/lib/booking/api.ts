// Booking calendar client (/api/help?action=…, served by api/_bookingApi.js). The server generates the free slots
// and checks everything again: the browser only shows what it gets.
import type { SchoolLang } from "@/lib/school/lang";

export interface Slots {
  timezone: string;
  durationMinutes: number;
  /** Days offered after today (BOOKING.horizonDays): the day grid shows that many; 0 when the server sent none. */
  horizonDays: number;
  /** Starts of the free slots, in ms, in chronological order. */
  slots: number[];
  /** The server's time when it sent them (its Date header), or the device's: "today" of the day grid. */
  now: number;
}

/** Free slots; throws when they cannot be loaded (react-query shows the error and retries on demand). */
export async function fetchSlots(): Promise<Slots> {
  const res = await fetch("/api/help?action=slots", { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok || !Array.isArray(data.slots)) {
    throw Object.assign(new Error("slots_unavailable"), { status: res.status });
  }
  const serverNow = Date.parse(res.headers.get("date") ?? "");
  return {
    timezone: data.timezone,
    durationMinutes: data.durationMinutes,
    // 0 (the free slots alone then set the grid's days) only from a server older than this page.
    horizonDays: Number.isInteger(data.horizonDays) && data.horizonDays > 0 ? data.horizonDays : 0,
    slots: data.slots.map((s: string) => Date.parse(s)).filter((ms: number) => Number.isFinite(ms)),
    now: Number.isFinite(serverNow) ? serverNow : Date.now(),
  };
}

export interface BookingInput {
  name: string;
  email: string;
  company: string;
  role: string;
  phone: string;
  message: string;
  business: boolean;
  /** Slot start as sent by the server (ISO 8601, UTC). */
  start: string;
  /** The visitor's IANA time zone. */
  tz: string;
  lang: SchoolLang;
  website: string; // honeypot
}

export type BookingField = "name" | "email" | "company" | "role" | "phone" | "message" | "business";
export type BookingFieldError = "required" | "invalid" | "too_short" | "too_long";

export type BookingResult =
  | { ok: true; number: string; start: string }
  | { ok: false; error: "invalid"; fields: Partial<Record<BookingField | "start", BookingFieldError>> }
  | { ok: false; error: "business_only"; field: "company" | "email" }
  | { ok: false; error: "slot_taken" | "invalid_slot" | "already_booked" | "rate_limited" | "error" };

const KNOWN = ["slot_taken", "invalid_slot", "already_booked", "rate_limited"] as const;

export async function bookCall(input: BookingInput): Promise<BookingResult> {
  try {
    const res = await fetch("/api/help?action=book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok && typeof data.number === "string") return { ok: true, number: data.number, start: data.start };
    if (data.error === "invalid") return { ok: false, error: "invalid", fields: data.fields ?? {} };
    if (data.error === "business_only") return { ok: false, error: "business_only", field: data.field === "email" ? "email" : "company" };
    if (res.status === 429) return { ok: false, error: "rate_limited" };
    if ((KNOWN as readonly string[]).includes(data.error)) return { ok: false, error: data.error };
    return { ok: false, error: "error" };
  } catch {
    return { ok: false, error: "error" };
  }
}

export interface BookingInfo {
  number: string;
  start: number;
  durationMinutes: number;
  /** The time zone the call was booked from. */
  timezone: string;
  status: "upcoming" | "cancelled" | "past";
}

type Failure = "invalid" | "rate_limited" | "error";

/** What the cancel page shows. Reading never cancels anything. */
export async function fetchBooking(token: string): Promise<{ ok: true; booking: BookingInfo } | { ok: false; error: Failure }> {
  try {
    const res = await fetch(`/api/help?action=booking&t=${encodeURIComponent(token)}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      return {
        ok: true,
        booking: {
          number: data.number,
          start: Date.parse(data.start),
          durationMinutes: data.durationMinutes,
          timezone: data.timezone,
          status: data.status,
        },
      };
    }
    if (res.status === 400 || res.status === 404) return { ok: false, error: "invalid" };
    return { ok: false, error: res.status === 429 ? "rate_limited" : "error" };
  } catch {
    return { ok: false, error: "error" };
  }
}

export type CancelResult = { ok: true } | { ok: false; error: Failure | "already_cancelled" | "past" };

export async function cancelBooking(token: string): Promise<CancelResult> {
  try {
    const res = await fetch("/api/help?action=cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: token }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) return { ok: true };
    if (data.error === "already_cancelled" || data.error === "past") return { ok: false, error: data.error };
    if (res.status === 400 || res.status === 404) return { ok: false, error: "invalid" };
    return { ok: false, error: res.status === 429 ? "rate_limited" : "error" };
  } catch {
    return { ok: false, error: "error" };
  }
}
