import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Download, RefreshCw, Search } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { adminFetch, isUnauthorized } from "@/lib/admin";
import { intakeLabel } from "@/lib/school/lang";
import { Seo } from "@/components/Seo";
import { LiveSummary } from "@/components/admin/LiveSummary";
import { SalesDashboard } from "@/components/admin/SalesDashboard";
import { fmtCount, useLiveStats } from "@/components/admin/statsApi";

type Row = {
  id: string;
  public_ref: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_e164: string;
  status: string;
  amount_paid_cents: number | null;
  currency: string | null;
  paid_at: string | null;
  created_at: string;
  major: string | null;
  graduation_year: number | null;
  heard_about: string | null;
  utm_source: string | null;
  terms_version: string | null;
  waiver_at: string | null;
  marketing_opt_in: boolean;
  university: string | null;
  intake: string | null;
  mode: "test" | "live";
  // Student space (from the database)
  account: boolean;
  modules_done: number;
  best_score: number | null;
  test_total: number | null;
  certificate_code: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  paid: "Payée",
  pending_payment: "En attente de paiement",
  expired: "Expirée",
  payment_failed: "Paiement échoué",
  refunded: "Remboursée",
  canceled: "Annulée",
};

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  paid: { bg: "#E3EDE7", fg: "#305D55" },
  pending_payment: { bg: "#FDEBDD", fg: "#B4561F" },
  expired: { bg: "#F5EFE5", fg: "#6B7672" },
  payment_failed: { bg: "#FEF2F2", fg: "#B91C1C" },
  refunded: { bg: "#EEE8DD", fg: "#4B5B58" },
  canceled: { bg: "#EEE8DD", fg: "#4B5B58" },
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" }) : "—";

const fmtMoney = (cents: number, currency = "eur") =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

function toCsv(rows: Row[]) {
  const cols = [
    "public_ref", "status", "first_name", "last_name", "email", "phone_e164", "university", "intake",
    "major", "graduation_year", "amount_paid", "currency", "paid_at", "created_at", "heard_about", "utm_source",
    "marketing_opt_in", "terms_version", "withdrawal_waiver_at", "mode",
    "account", "modules_done", "best_score", "test_total", "certificate_code",
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.public_ref, r.status, r.first_name, r.last_name, r.email, r.phone_e164, r.university, r.intake,
      r.major, r.graduation_year, r.amount_paid_cents != null ? (r.amount_paid_cents / 100).toFixed(2) : "",
      r.currency, r.paid_at, r.created_at, r.heard_about, r.utm_source, r.marketing_opt_in, r.terms_version, r.waiver_at, r.mode,
      r.account, r.modules_done, r.best_score, r.test_total, r.certificate_code,
    ].map(esc).join(","),
  );
  return [cols.join(","), ...lines].join("\n");
}

export default function Registrations() {
  const { signOut } = useAuth();
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");

  const query = useQuery({
    queryKey: ["admin", "registrations"],
    queryFn: async () => (await adminFetch<{ rows: Row[] }>("/api/admin/registrations")).rows,
    staleTime: 0,
    refetchInterval: 60_000, // new sales appear without reloading the page
    refetchOnWindowFocus: true,
  });
  // People on the site right now, student accounts and today's funnel (refreshed every 30 s, details in /admin/stats).
  const live = useLiveStats();

  const rows = query.data ?? [];

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (!needle) return true;
      return [r.public_ref, r.first_name, r.last_name, r.email, r.university, r.certificate_code]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [rows, status, q]);

  const pending = rows.filter((r) => r.status === "pending_payment").length;

  const exportCsv = () => {
    const blob = new Blob(["﻿" + toCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reetma-registrations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      <Seo title="Tableau de bord | Reetma back office" description="Ventes, trafic et inscriptions" path="/admin/registrations" lang="fr" noindex />
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: "#1F3B36" }}>Tableau de bord</h1>
          <p className="text-sm" style={{ color: "#6B7672" }}>Ventes, chiffre d'affaires et trafic en direct, puis les inscriptions à L'École lues depuis Stripe, les plus récentes en premier.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => query.refetch()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md border bg-white text-sm"
            style={{ borderColor: "#ECE5D9", color: "#3A4F4A" }}
          >
            <RefreshCw className={`w-4 h-4 ${query.isFetching ? "animate-spin" : ""}`} /> Actualiser
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!filtered.length}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "#305D55" }}
          >
            <Download className="w-4 h-4" /> Exporter en CSV
          </button>
        </div>
      </div>

      <SalesDashboard sales={rows} live={live.data} loading={query.isLoading} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: "Comptes étudiants", value: fmtCount(live.data?.accounts.total), to: "/admin/stats" },
          { label: "Inscriptions (toutes)", value: rows.length.toLocaleString("fr-FR") },
          { label: "En attente de paiement", value: pending.toLocaleString("fr-FR") },
        ].map((k) => {
          const body = (
            <>
              <p className="text-xs uppercase tracking-wide" style={{ color: "#4B5B58" }}>{k.label}</p>
              <p className="text-xl font-bold mt-1 flex items-center justify-between gap-2" style={{ color: "#1F3B36" }}>
                {k.value}
                {k.to && <ArrowRight className="w-4 h-4 shrink-0" style={{ color: "#6B7672" }} aria-hidden="true" />}
              </p>
            </>
          );
          return k.to ? (
            <Link
              key={k.label}
              to={k.to}
              className="flex flex-col justify-between rounded-lg border bg-white p-3 hover:bg-[#FBF7F0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#305D55]"
              style={{ borderColor: "#ECE5D9" }}
            >
              {body}
              <span className="sr-only">Voir les statistiques</span>
            </Link>
          ) : (
            <div key={k.label} className="flex flex-col justify-between rounded-lg border bg-white p-3" style={{ borderColor: "#ECE5D9" }}>
              {body}
            </div>
          );
        })}
      </div>

      {live.data && <LiveSummary stats={live.data} />}

      <div className="flex flex-col sm:flex-row gap-3">
        <label className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#9AA49F" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher : nom, e-mail, référence, université, certificat"
            className="w-full h-10 pl-9 pr-3 rounded-md border bg-white text-sm outline-none focus:ring-1"
            style={{ borderColor: "#ECE5D9" }}
          />
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-10 px-3 rounded-md border bg-white text-sm"
          style={{ borderColor: "#ECE5D9", color: "#3A4F4A" }}
          aria-label="Filtrer par statut"
        >
          <option value="all">Tous les statuts</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border bg-white overflow-x-auto" style={{ borderColor: "#ECE5D9" }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "#6B7672", background: "#FBF7F0" }}>
              <th className="px-4 py-3 font-semibold">Étudiant</th>
              <th className="px-4 py-3 font-semibold">Université</th>
              <th className="px-4 py-3 font-semibold">Promotion</th>
              <th className="px-4 py-3 font-semibold">Statut</th>
              <th className="px-4 py-3 font-semibold text-right">Montant</th>
              <th className="px-4 py-3 font-semibold">Espace étudiant</th>
              <th className="px-4 py-3 font-semibold">Inscrit le</th>
              <th className="px-4 py-3 font-semibold">Réf.</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr><td colSpan={8} className="px-4 py-10 text-center" style={{ color: "#6B7672" }}>Chargement…</td></tr>
            )}
            {query.isError && (
              <tr><td colSpan={8} className="px-4 py-10 text-center" style={{ color: "#B91C1C" }}>
                {isUnauthorized(query.error) ? (
                  <>
                    Votre session a expiré.{" "}
                    <button type="button" onClick={signOut} className="font-semibold underline underline-offset-2">
                      Se reconnecter
                    </button>
                  </>
                ) : (
                  "Impossible de lire les inscriptions. Vérifiez STRIPE_SECRET_KEY sur le serveur, puis cliquez sur Actualiser."
                )}
              </td></tr>
            )}
            {!query.isLoading && !query.isError && filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center" style={{ color: "#6B7672" }}>Aucune inscription ne correspond.</td></tr>
            )}
            {filtered.map((r) => {
              const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.expired;
              return (
                <tr key={r.id} className="border-t" style={{ borderColor: "#F5EFE5" }}>
                  <td className="px-4 py-3">
                    <p className="font-medium" style={{ color: "#1F3B36" }}>{r.first_name} {r.last_name}</p>
                    <p className="text-xs" style={{ color: "#6B7672" }}>{r.email} · {r.phone_e164}</p>
                    {r.mode === "test" && (
                      <span className="inline-block mt-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: "#FDEBDD", color: "#B4561F" }}>
                        Test
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3" style={{ color: "#3A4F4A" }}>{r.university ?? "—"}</td>
                  <td className="px-4 py-3" style={{ color: "#3A4F4A" }}>{r.intake ? intakeLabel(r.intake, "fr") : "—"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap" style={{ background: st.bg, color: st.fg }}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums" style={{ color: "#1F3B36" }}>
                    {r.amount_paid_cents != null ? fmtMoney(r.amount_paid_cents, r.currency ?? "eur") : "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: "#4B5B58" }}>
                    {r.account ? (
                      <>
                        <p style={{ color: "#305D55" }}>Compte ✓ · Modules {r.modules_done}/3</p>
                        <p>Test {r.best_score !== null ? `${r.best_score}/${r.test_total}` : "—"}</p>
                        {r.certificate_code && <p className="font-mono" style={{ color: "#1F3B36" }}>{r.certificate_code}</p>}
                      </>
                    ) : (
                      <span style={{ color: r.status === "paid" ? "#B4561F" : "#9AA49F" }}>
                        {r.status === "paid" ? "Pas encore de compte" : "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: "#4B5B58" }}>{fmtDate(r.created_at)}</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: "#6B7672" }}>{r.public_ref}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
