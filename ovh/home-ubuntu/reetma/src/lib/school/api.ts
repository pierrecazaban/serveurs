// L'École client API. Payments go through Reetma's own serverless functions (/api/school/*),
// which talk to Mollie. There is no database: Mollie payments are the registrations.
import universities from "@/data/universities.json";
import { schoolConfig } from "@/config/school";
import type {
  PublicIntake,
  RegistrationDetails,
  RegistrationStatus,
  StartRegistrationResult,
  University,
} from "./types";
import { getUtm } from "./tracking";
import { reportFunnelEvent } from "@/lib/presence";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T;
  } catch {
    return { result: "error" } as T;
  }
}

export async function fetchUniversities(): Promise<University[]> {
  return universities as University[];
}

export async function fetchPublicIntake(): Promise<PublicIntake> {
  return {
    status: "open",
    intake_id: schoolConfig.intake.id,
    name: schoolConfig.intake.name,
    capacity: schoolConfig.seatsDisplay?.total,
    seats_left: schoolConfig.seatsDisplay?.left,
  };
}

export async function startRegistration(
  details: RegistrationDetails & Record<string, unknown>,
): Promise<StartRegistrationResult> {
  return postJson<StartRegistrationResult>("/api/school/register", { ...details, utm: getUtm() });
}

export async function getRegistrationStatus(paymentId: string): Promise<RegistrationStatus> {
  try {
    const res = await fetch(`/api/school/status?pid=${encodeURIComponent(paymentId)}`);
    return (await res.json()) as RegistrationStatus;
  } catch {
    return { status: "not_found" };
  }
}

// Names the waitlist form still uses, mapped to the events /api/track accepts.
const EVENT_NAMES = new Map([
  ["not_listed_submit", "not_listed_submitted"],
  ["waitlist_join", "waitlist_submitted"],
]);

/** Back-office sales funnel: sent to /api/track with this tab's visit (src/lib/presence.ts). */
export async function recordFunnelEvent(eventName: string, _universityId?: string): Promise<void> {
  reportFunnelEvent(EVENT_NAMES.get(eventName) ?? eventName);
}
