import { isTrackingOptedOut } from "@/lib/track";

/** Sent with the registration: api/school/register.js keeps utm_source in the payment's metadata. */
export interface Utm {
  utm_source?: string;
}

// The campaign source of the address the visitor arrived by (?utm_source=…). It stays in this page's memory:
// nothing is written to the browser for it (that would need consent, article 82 of the loi Informatique et
// Libertés), so a reload keeps it only while the address still carries it.
let utm: Utm = {};

/** Reads the campaign source from this page's address; an address without one keeps the previous one. */
export function captureUtm(): Utm {
  const source = new URLSearchParams(window.location.search).get("utm_source");
  if (source) utm = { utm_source: source.slice(0, 120) };
  return utm;
}

/** The campaign source to send with the registration, unless this browser opted out of being counted. */
export function getUtm(): Utm {
  return isTrackingOptedOut() ? {} : utm;
}

export function clearSchoolSession() {
  try {
    sessionStorage.removeItem("school_form_state");
    sessionStorage.removeItem("school_reservation");
  } catch {
    /* storage unavailable */
  }
}
