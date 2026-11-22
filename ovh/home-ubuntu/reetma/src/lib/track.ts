// Site analytics now run on Vercel Web Analytics (cookieless). This module keeps the
// small API the pages use, plus the visitor opt-out stored in this browser.
const OPT_OUT_KEY = "reetma_no_track";
/** The visit kept in this browser from the click on "Pay" until it is back (src/lib/presence.ts). */
export const MOLLIE_VISIT_KEY = "reetma_vid_mollie";

export function isTrackingOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTrackingOptOut(optOut: boolean) {
  try {
    if (optOut) {
      // Once opted out, no beat would ever erase the visit kept for the return from Mollie: forget it now.
      localStorage.removeItem(MOLLIE_VISIT_KEY);
      localStorage.setItem(OPT_OUT_KEY, "1");
    } else {
      localStorage.removeItem(OPT_OUT_KEY);
    }
  } catch {
    /* storage unavailable */
  }
}

export function isTrackingDisabled(): boolean {
  return typeof window === "undefined" || isTrackingOptedOut();
}

// Page views are recorded automatically by <Analytics />; these stay as no-ops for callers.
export function trackPageview(_path: string) {}
export function trackClick(_label: string) {}
export function observeSections(_selector = "section[id]") {}
export function trackChatStart() {}
export function trackChatMessage(_text: string) {}
