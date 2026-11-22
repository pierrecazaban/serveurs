// Audience measurement for the back office (api/track.js): which page each visit is on right now, and the
// sales funnel. A visit is a random id kept in this tab only (sessionStorage, gone when the tab closes; from the
// click on "Pay" until the visit is back, also in this browser's localStorage, see MOLLIE_VISIT_KEY): no cookie,
// and the server stores no IP address. Only location.pathname is sent, never the query string or the hash (they
// carry ?pid=, ?token= and codes), not even in the Referer header. Nothing is sent by automated browsers, inside a
// frame, when this browser opted out (the back office does it too: at sign-in and whenever it is shown), while an
// admin token is present, or on /admin and /auth.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getAdminToken } from "@/lib/admin";
import { MOLLIE_VISIT_KEY, isTrackingOptedOut } from "@/lib/track";
import { SCHOOL_PATHS, schoolLangOf } from "@/lib/school/lang";

/** Where a visit is in the registration: form steps 1 to 4 (4 = payment step), then leaving for Mollie. */
export type PresenceStep = "form_1" | "form_2" | "form_3" | "form_4" | "mollie";

const VISIT_KEY = "reetma_vid";
// The visit that left for Mollie, with the time (MOLLIE_VISIT_KEY): the confirmation page carries it on even when
// the person comes back in another tab (a bank app opens a new one), so its beats replace the "mollie" row instead
// of counting the person twice. It stays in this browser: nothing links the visit to the payment. Opting out erases
// it (src/lib/track.ts).
const MOLLIE_MS = 10 * 60_000; // the back office counts a visit on the Mollie page for 10 min at most (api/track.js)
const CONFIRMATION: string[] = [SCHOOL_PATHS.en.confirmation, SCHOOL_PATHS.fr.confirmation];
const BEAT_MS = 60_000; // the back office counts a visit as online for 150 s after its last beat
// No beat after 3 min without interaction, until the next one: every beat keeps the Neon database awake.
// Exported for the explanation on /admin/stats.
export const IDLE_MS = 3 * 60_000;
const SETTLE_MS = 300; // the route and step changes of one click make a single beat
const ACTIVITY = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"] as const;

let visitId: string | null = null;
let step: PresenceStep | null = null;
let lastActivity = Date.now();
let lastBeat = { state: "", at: 0 };
let timer: number | undefined;

function allowed(pathname: string): boolean {
  // Inside a frame, another site would make its own visitors count here (vercel.json already forbids frames).
  if (window.top !== window.self) return false;
  return !navigator.webdriver && !isTrackingOptedOut() && !getAdminToken() && !/^\/+(admin|auth)/i.test(pathname);
}

/** 16 random bytes as 22 base64url characters. */
function newVisitId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The visit that left this browser for Mollie less than 10 min ago, or null; an older one is forgotten. */
function mollieVisit(): string | null {
  try {
    const [v, at] = (localStorage.getItem(MOLLIE_VISIT_KEY) ?? "").split(" ");
    const age = Date.now() - Number(at);
    if (/^[A-Za-z0-9_-]{22}$/.test(v) && age >= 0 && age < MOLLIE_MS) return v;
    localStorage.removeItem(MOLLIE_VISIT_KEY);
  } catch {
    /* storage unavailable */
  }
  return null;
}

/** Keeps the visit leaving for Mollie (or forgets it, with null). */
function keepMollieVisit(v: string | null) {
  try {
    if (v) localStorage.setItem(MOLLIE_VISIT_KEY, `${v} ${Date.now()}`);
    else localStorage.removeItem(MOLLIE_VISIT_KEY);
  } catch {
    /* storage unavailable: a return in another tab counts as a new visit */
  }
}

/** This tab's visit id, or null when nothing may be sent. It never leaves this measurement: no link to a person. */
function presenceVisitId(): string | null {
  if (typeof window === "undefined" || !allowed(window.location.pathname)) return null;
  if (!visitId) {
    try {
      visitId = sessionStorage.getItem(VISIT_KEY);
    } catch {
      /* storage unavailable */
    }
    // Back from Mollie in a new tab: the confirmation page carries on the visit that left to pay.
    const back = !visitId && CONFIRMATION.includes(window.location.pathname) ? mollieVisit() : null;
    if (back || !visitId || !/^[A-Za-z0-9_-]{22}$/.test(visitId)) {
      visitId = back ?? newVisitId();
      try {
        sessionStorage.setItem(VISIT_KEY, visitId);
      } catch {
        /* storage unavailable: a new visit on every page load */
      }
    }
  }
  return visitId;
}

function send(extra: { step?: PresenceStep; event?: string } = {}, keepalive = false) {
  window.clearTimeout(timer);
  const v = presenceVisitId();
  if (!v) return;
  const path = window.location.pathname;
  const current = extra.step ?? step;
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v, path, step: current, lang: schoolLangOf(path), event: extra.event }),
    keepalive,
    referrerPolicy: "no-referrer", // the Referer header would carry the page's query string (?pid=, ?token=)
  }).catch(() => {
    /* a lost beat is replaced by the next one */
  });
  // Back on the site after Mollie, in this tab or another: this beat replaces the "mollie" row.
  if (current !== "mollie" && mollieVisit() === v) keepMollieVisit(null);
  lastBeat = { state: `${path} ${current}`, at: Date.now() };
  timer = window.setTimeout(tick, BEAT_MS);
}

// Every 60 s while the tab is visible and was used in the last 3 min; otherwise paused until the tab is
// shown again or the next interaction.
function tick() {
  if (document.visibilityState === "visible" && Date.now() - lastActivity < IDLE_MS) send();
}

/** A beat shortly after a route or step change, unless an event has just sent the same page. */
function schedule() {
  if (lastBeat.state === `${window.location.pathname} ${step}` && Date.now() - lastBeat.at < SETTLE_MS) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => send(), SETTLE_MS);
}

function onActivity() {
  const resumed = Date.now() - lastActivity >= IDLE_MS;
  lastActivity = Date.now();
  if (resumed) send();
}

function onVisible() {
  if (document.visibilityState !== "visible") return;
  lastActivity = Date.now();
  // Out of the back/forward cache, visibilitychange and pageshow fire together: a single beat.
  if (lastBeat.state === `${window.location.pathname} ${step}` && Date.now() - lastBeat.at < SETTLE_MS) return;
  send();
}

// Back from Mollie with the browser's back button: the page comes out of the back/forward cache.
function onPageShow(event: PageTransitionEvent) {
  if (event.persisted) onVisible();
}

/** Mounted once, in PublicLayout: a beat on every route change, then every 60 s. */
export function usePresence() {
  const { pathname } = useLocation();

  useEffect(() => {
    const options = { capture: true, passive: true };
    ACTIVITY.forEach((type) => window.addEventListener(type, onActivity, options));
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.clearTimeout(timer);
      ACTIVITY.forEach((type) => window.removeEventListener(type, onActivity, options));
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  useEffect(() => {
    schedule();
  }, [pathname]);
}

/** The registration form reports its step, and null once it is left. */
export function setPresenceStep(next: PresenceStep | null) {
  if (next === step) return;
  step = next;
  schedule();
}

/**
 * Click on "Pay", just before the browser leaves for Mollie: keepalive lets the request outlive the page. Its event
 * is the funnel's "Parti payer sur Mollie" stage.
 */
export function reportPaymentRedirect() {
  send({ step: "mollie", event: "pay_click" }, true);
  keepMollieVisit(presenceVisitId());
}

/** A step of the sales funnel (school_view, register_start…), sent with the page it happened on. */
export function reportFunnelEvent(event: string) {
  send({ event });
}
