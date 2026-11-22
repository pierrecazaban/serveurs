// Help-center requests (/api/help). Tickets are answered from the back office (/admin/tickets).
import type { SchoolLang } from "@/lib/school/lang";

export const TICKET_CATEGORIES = [
  "account",
  "payment",
  "refund",
  "program",
  "certificate",
  "waitlist",
  "project",
  "call",
  "other",
] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

// What the help-center form offers: a "call" ticket only comes from the booking calendar (/book-a-call).
export type RequestCategory = Exclude<TicketCategory, "call">;
export const REQUEST_CATEGORIES = TICKET_CATEGORIES.filter((c): c is RequestCategory => c !== "call");

export const CATEGORY_LABELS: Record<SchoolLang, Record<TicketCategory, string>> = {
  en: {
    account: "My account and password",
    payment: "Payment",
    refund: "Refund",
    program: "The training (modules, final test)",
    certificate: "Certificate",
    waitlist: "Waitlist",
    project: "Business project / book a call",
    call: "Call booked",
    other: "Something else",
  },
  fr: {
    account: "Mon compte et mon mot de passe",
    payment: "Paiement",
    refund: "Remboursement",
    program: "La formation (modules, test final)",
    certificate: "Certificat",
    waitlist: "Liste d'attente",
    project: "Projet d'entreprise / prendre rendez-vous",
    call: "Appel réservé",
    other: "Autre chose",
  },
};

export const isTicketCategory = (v: string | null): v is TicketCategory =>
  !!v && (TICKET_CATEGORIES as readonly string[]).includes(v);

export const isRequestCategory = (v: string | null): v is RequestCategory =>
  !!v && (REQUEST_CATEGORIES as readonly string[]).includes(v);

export interface TicketInput {
  name: string;
  email: string;
  category: RequestCategory;
  reference?: string;
  subject: string;
  message: string;
  lang: SchoolLang;
  website?: string; // honeypot
}

export type TicketFieldError = "required" | "invalid" | "too_short" | "too_long";

export type TicketResult =
  | { ok: true; number: string }
  | { ok: false; error: "invalid"; fields: Partial<Record<keyof TicketInput, TicketFieldError>> }
  | { ok: false; error: "rate_limited" | "error" };

export async function createTicket(input: TicketInput): Promise<TicketResult> {
  try {
    const res = await fetch("/api/help?action=create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) return { ok: true, number: data.number };
    if (res.status === 400 && data.error === "invalid") return { ok: false, error: "invalid", fields: data.fields ?? {} };
    if (res.status === 429) return { ok: false, error: "rate_limited" };
    return { ok: false, error: "error" };
  } catch {
    return { ok: false, error: "error" };
  }
}
