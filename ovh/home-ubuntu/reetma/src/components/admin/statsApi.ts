// Site audience for the back office (GET /api/track?action=stats): who is on the site right now, how many
// student accounts exist, and the sales funnel over a period. A visit is a browser tab, never a named person.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin";

export type StatsRange = "2h" | "today" | "7d" | "30d" | "all";
export type StatsCount = { key: string; label: string; count: number };
/** A page people are on. On L'École's page, `form` counts those in the registration form, by step. */
export type OnlinePage = StatsCount & { form?: StatsCount[] };

export type Stats = {
  generated_at: string;
  mode: "live" | "test";
  online: { total: number; window_seconds: number; pages: OnlinePage[] };
  accounts: { total: number };
  funnel: { range: StatsRange; stages: StatsCount[] };
};

export const RANGES: { key: StatsRange; label: string; caption: string }[] = [
  { key: "2h", label: "2 heures", caption: "sur les 2 dernières heures" },
  { key: "today", label: "Aujourd'hui", caption: "aujourd'hui depuis minuit (heure de Paris)" },
  { key: "7d", label: "7 jours", caption: "sur les 7 derniers jours" },
  { key: "30d", label: "30 jours", caption: "sur les 30 derniers jours" },
  { key: "all", label: "Tout", caption: "depuis le début de la mesure (13 mois au plus)" },
];

// Bars wear BAR; text always wears the INK tokens, never the bar color. RULE is the hairline color.
export const BAR = "#1F8A70";
export const INK = { primary: "#1F3B36", secondary: "#4B5B58", muted: "#6B7672" } as const;
export const RULE = "#ECE5D9";

const getStats = (range: StatsRange) => adminFetch<Stats>(`/api/track?action=stats&range=${range}`);

/** Deletes the visits and funnel events recorded so far: every count starts again from 0. */
export const resetStats = () => adminFetch<{ ok: true }>("/api/track?action=reset", { method: "POST", body: {} });

// The live funnel: where the people online right now are, from L'École to the certificate (other pages left out).
const LIVE_FORM: [string, string][] = [
  ["form_1", "Formulaire : université"],
  ["form_2", "Formulaire : coordonnées"],
  ["form_3", "Formulaire : vérification"],
  ["form_4", "Formulaire : paiement"],
];

export function liveFunnel(pages: OnlinePage[]): StatsCount[] {
  const count = (test: (key: string) => boolean) => pages.filter((p) => test(p.key)).reduce((n, p) => n + p.count, 0);
  const schools = pages.filter((p) => p.key === "school_en" || p.key === "school_fr");
  const inForm = (key: string) => schools.reduce((n, p) => n + (p.form?.find((f) => f.key === key)?.count ?? 0), 0);
  const formTotal = LIVE_FORM.reduce((n, [key]) => n + inForm(key), 0);
  return [
    { key: "school", label: "Sur L'École", count: schools.reduce((n, p) => n + p.count, 0) - formTotal },
    ...LIVE_FORM.map(([key, label]) => ({ key, label, count: inForm(key) })),
    { key: "mollie", label: "Paiement Stripe", count: count((k) => k === "mollie") },
    { key: "confirmation", label: "Création du mot de passe", count: count((k) => k === "confirmation") },
    { key: "account", label: "Espace étudiant", count: count((k) => k === "account") },
    { key: "modules", label: "Dans un module", count: count((k) => k.startsWith("module_")) },
    { key: "test", label: "Test final", count: count((k) => k === "test") },
    { key: "certificate", label: "Certificat", count: count((k) => k === "certificate") },
  ];
}

/** People online, student accounts and today's funnel, refreshed every 30 s (shared by /admin and /admin/stats). */
export function useLiveStats() {
  return useQuery({
    queryKey: ["admin", "stats", "live"],
    queryFn: () => getStats("today"),
    refetchInterval: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: false,
  });
}

/** The funnel over a period, refreshed every 60 s. On a period change the previous funnel stays until the new one arrives. */
export function useFunnelStats(range: StatsRange) {
  return useQuery({
    queryKey: ["admin", "stats", "funnel", range],
    queryFn: () => getStats(range),
    refetchInterval: 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}

const integer = new Intl.NumberFormat("fr-FR");

// Thousands grouped with a regular no-break space: Inter draws the narrow one too thin to see ("1 240", not "1240").
export const fmtCount = (n: number | null | undefined) =>
  typeof n === "number" ? integer.format(n).replace(/\u202F/g, "\u00A0") : "—";

/** Visits of a page that are in its registration form ("dont 2 dans le formulaire"), or "" when there are none. */
export function formNote(page: OnlinePage) {
  const n = page.form?.reduce((sum, s) => sum + s.count, 0) ?? 0;
  return n ? `dont ${fmtCount(n)} dans le formulaire` : "";
}

/** `part` as a share of `whole` ("43 %", "4,3 %"), or "—" when there is nothing to divide by. */
export function fmtShare(part: number, whole: number | null | undefined) {
  if (!whole) return "—";
  const r = part / whole;
  if (r > 0 && r < 0.001) return "<\u00A00,1\u202F%";
  return new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: r < 0.1 ? 1 : 0 }).format(r);
}

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" });
