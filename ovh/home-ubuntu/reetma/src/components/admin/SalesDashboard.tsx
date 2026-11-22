// Top of /admin: sales and revenue over a period (from the registrations the page already loads from Stripe), the
// live audience (from the stats polled every 30 s) and the revenue of the last 30 days, day by day (Paris time).
// A sale is a paid registration; a refunded one leaves both the count and the revenue.
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { BarTip, Panel, Segmented } from "./StatsUi";
import { BAR, INK, RULE, fmtCount, type Stats } from "./statsApi";

export type Sale = { status: string; amount_paid_cents: number | null; currency: string | null; paid_at: string | null };

type Period = "today" | "7d" | "30d" | "all";
const PERIODS: { key: Period; label: string; days: number | null; caption: string; previous: string }[] = [
  { key: "today", label: "Aujourd'hui", days: 1, caption: "aujourd'hui (heure de Paris)", previous: "hier" },
  { key: "7d", label: "7 jours", days: 7, caption: "sur les 7 derniers jours", previous: "les 7 jours précédents" },
  { key: "30d", label: "30 jours", days: 30, caption: "sur les 30 derniers jours", previous: "les 30 jours précédents" },
  { key: "all", label: "Tout", days: null, caption: "depuis l'ouverture des ventes", previous: "" },
];

const CHART_DAYS = 30;

// Calendar days in Paris time, as sortable keys ("2026-11-10").
const parisDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" });
const dayKey = (iso: string) => parisDay.format(new Date(iso));
/** The day `back` days before `key` (noon UTC keeps daylight saving changes out of the way). */
function shiftDay(key: string, back: number) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
const dayLabel = (key: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", ...opts });

function money(cents: number, currency: string, compact = false) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: compact || cents % 100 === 0 ? 0 : 2,
    notation: compact && cents >= 1_000_000 ? "compact" : "standard",
  })
    .format(cents / 100)
    .replace(/\u202F/g, "\u00A0");
}

const plural = (n: number, one: string, many: string) => `${fmtCount(n)}\u00A0${n > 1 ? many : one}`;

/** A round top for the chart's scale: 1, 2 or 5 times a power of ten, at least `max`. */
function niceTop(max: number) {
  if (max <= 0) return 0;
  const p = 10 ** Math.floor(Math.log10(max));
  return ([1, 2, 5, 10].find((m) => m * p >= max) ?? 10) * p;
}

function Tile({ label, value, note, to, live = false }: { label: string; value: string; note: string; to?: string; live?: boolean }) {
  const body = (
    <>
      <dt className="flex items-center gap-2 text-sm font-medium" style={{ color: INK.secondary }}>
        {live && (
          <span aria-hidden="true" className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:hidden" style={{ background: BAR }} />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: BAR }} />
          </span>
        )}
        {label}
        {to && <ArrowRight className="ml-auto h-4 w-4 shrink-0" style={{ color: INK.muted }} aria-hidden="true" />}
      </dt>
      <dd className="mt-2 text-3xl font-semibold leading-none tabular-nums sm:text-4xl" style={{ color: INK.primary }}>{value}</dd>
      <dd className="mt-2 text-xs" style={{ color: INK.muted }}>{note}</dd>
    </>
  );
  const cls = "block rounded-lg border bg-white p-4 sm:p-5";
  return to ? (
    <Link to={to} className={`${cls} hover:bg-[#FBF7F0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#305D55]`} style={{ borderColor: RULE }}>
      <dl>{body}</dl>
    </Link>
  ) : (
    <div className={cls} style={{ borderColor: RULE }}>
      <dl>{body}</dl>
    </div>
  );
}

type Day = { key: string; cents: number; count: number };

/** Revenue per day, one thin column each (4 px rounded top, square on the baseline), a tooltip per column. */
function DailyRevenue({ days, currency }: { days: Day[]; currency: string }) {
  const [active, setActive] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const top = niceTop(Math.max(0, ...days.map((d) => d.cents)));
  const totalCents = days.reduce((s, d) => s + d.cents, 0);
  const totalCount = days.reduce((s, d) => s + d.count, 0);
  const tip = active !== null ? days[active] : null;
  const shift = active !== null ? (active + 0.5) / days.length : 0;
  // Selective x labels: every 7th day back from today, today last.
  const showLabel = (i: number) => (days.length - 1 - i) % 7 === 0;

  return (
    <Panel className="p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-bold" style={{ color: INK.primary }}>Chiffre d'affaires par jour</h3>
        <p className="text-sm" style={{ color: INK.secondary }}>
          {CHART_DAYS} derniers jours : <span className="font-semibold" style={{ color: INK.primary }}>{money(totalCents, currency)}</span>, {plural(totalCount, "vente", "ventes")}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        {/* Scale: the round top and half of it; the baseline is the axis. */}
        <div className="relative h-40 w-14 text-right text-[11px] tabular-nums" style={{ color: INK.muted }} aria-hidden="true">
          {top > 0 && (
            <>
              <span className="absolute right-0 top-0 -translate-y-1/2">{money(top, currency, true)}</span>
              <span className="absolute right-0 top-1/2 -translate-y-1/2">{money(top / 2, currency, true)}</span>
            </>
          )}
          <span className="absolute bottom-0 right-0 translate-y-1/2">0</span>
        </div>

        <div ref={boxRef} className="relative h-40" onPointerLeave={() => setActive(null)}>
          {[0, 0.5].map((f) => (
            <div key={f} aria-hidden="true" className="absolute inset-x-0 h-px" style={{ top: `${f * 100}%`, background: RULE }} />
          ))}
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px" style={{ background: "#D9D0C1" }} />
          {totalCount === 0 && (
            <p className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: INK.muted }}>
              Aucune vente sur les {CHART_DAYS} derniers jours pour l'instant.
            </p>
          )}
          <ol role="list" aria-label="Chiffre d'affaires par jour" className="absolute inset-0 flex items-end gap-[2px]">
            {days.map((d, i) => {
              const h = top ? (d.cents / top) * 100 : 0;
              const date = dayLabel(d.key, { weekday: "long", day: "numeric", month: "long" });
              return (
                <li
                  key={d.key}
                  tabIndex={0}
                  aria-label={`${date} : ${money(d.cents, currency)}, ${plural(d.count, "vente", "ventes")}`}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive((a) => (a === i ? null : a))}
                  data-active={active === i}
                  className="group flex h-full min-w-0 flex-1 items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[#305D55] data-[active=true]:bg-[#FBF7F0]"
                >
                  {d.cents > 0 && (
                    <span
                      aria-hidden="true"
                      className="block w-full max-w-[24px] rounded-t forced-color-adjust-none group-data-[active=true]:brightness-110"
                      style={{ height: `max(2px, ${h}%)`, background: BAR }}
                    />
                  )}
                </li>
              );
            })}
          </ol>
          {tip && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute z-20 w-max max-w-[16rem] rounded-md border bg-white px-3 py-2 text-xs shadow-lg"
              style={{ left: `${shift * 100}%`, top: -8, transform: `translate(${-shift * 100}%, -100%)`, borderColor: RULE }}
            >
              <BarTip
                title={dayLabel(tip.key, { weekday: "long", day: "numeric", month: "long" })}
                value={money(tip.cents, currency)}
                rows={[[fmtCount(tip.count), tip.count > 1 ? "ventes" : "vente"]]}
              />
            </div>
          )}
        </div>

        <div />
        <div className="relative mt-1.5 h-4 text-[11px]" style={{ color: INK.muted }} aria-hidden="true">
          {days.map((d, i) =>
            showLabel(i) ? (
              <span
                key={d.key}
                className="absolute whitespace-nowrap"
                style={{ left: `${((i + 0.5) / days.length) * 100}%`, transform: i === days.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}
              >
                {i === days.length - 1 ? "Aujourd'hui" : dayLabel(d.key, { day: "numeric", month: "short" })}
              </span>
            ) : null,
          )}
        </div>
      </div>

      <details className="mt-3 text-sm" style={{ color: INK.secondary }}>
        <summary className="w-fit cursor-pointer font-medium" style={{ color: INK.primary }}>Voir les chiffres jour par jour</summary>
        <table className="mt-2 w-full max-w-md text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide" style={{ color: INK.muted }}>
              <th className="py-1 font-semibold">Jour</th>
              <th className="py-1 text-right font-semibold">Ventes</th>
              <th className="py-1 text-right font-semibold">Chiffre d'affaires</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.key} className="border-t" style={{ borderColor: "#F5EFE5" }}>
                <td className="py-1">{dayLabel(d.key, { weekday: "short", day: "numeric", month: "short" })}</td>
                <td className="py-1 text-right tabular-nums">{fmtCount(d.count)}</td>
                <td className="py-1 text-right tabular-nums" style={{ color: INK.primary }}>{money(d.cents, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Panel>
  );
}

export function SalesDashboard({ sales, live, loading }: { sales: Sale[]; live?: Stats; loading: boolean }) {
  const [period, setPeriod] = useState<Period>("today");
  const p = PERIODS.find((x) => x.key === period)!;

  const data = useMemo(() => {
    const paid = sales
      .filter((s) => s.status === "paid" && s.paid_at && s.amount_paid_cents != null)
      .map((s) => ({ day: dayKey(s.paid_at!), cents: s.amount_paid_cents! }));
    const today = parisDay.format(new Date());
    const sum = (from: string | null, to: string) => {
      const list = paid.filter((s) => (from === null || s.day >= from) && s.day <= to);
      return { count: list.length, cents: list.reduce((n, s) => n + s.cents, 0) };
    };
    const current = p.days ? sum(shiftDay(today, p.days - 1), today) : sum(null, today);
    const previous = p.days ? sum(shiftDay(today, 2 * p.days - 1), shiftDay(today, p.days)) : null;
    const days: Day[] = Array.from({ length: CHART_DAYS }, (_, i) => {
      const key = shiftDay(today, CHART_DAYS - 1 - i);
      const list = paid.filter((s) => s.day === key);
      return { key, count: list.length, cents: list.reduce((n, s) => n + s.cents, 0) };
    });
    return { current, previous, days };
  }, [sales, p.days]);

  const currency = sales.find((s) => s.currency)?.currency ?? "EUR";
  const { current, previous } = data;
  const vs = (now: number, before: number, fmt: (n: number) => string) => {
    if (!previous) return p.caption;
    const d = now - before;
    if (d === 0) return `${p.caption} · autant ${p.previous === "hier" ? "qu'hier" : `que ${p.previous}`}`;
    return `${p.caption} · ${d > 0 ? "+" : "−"}${fmt(Math.abs(d))} par rapport à ${p.previous}`;
  };
  const visits = live?.funnel.stages.find((s) => s.key === "site")?.count;
  const dash = loading ? "…" : undefined;

  return (
    <section aria-labelledby="sales-title" className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="sales-title" className="text-lg font-bold" style={{ color: INK.primary }}>Ventes et trafic</h2>
          <p className="text-sm" style={{ color: INK.secondary }}>
            Ventes payées sur Stripe (hors remboursements), actualisées chaque minute ; visiteurs toutes les 30 secondes.
          </p>
        </div>
        <Segmented label="Période des ventes" options={PERIODS.map(({ key, label }) => ({ key, label }))} value={period} onChange={setPeriod} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Ventes"
          value={dash ?? fmtCount(current.count)}
          note={previous ? vs(current.count, previous.count, (n) => fmtCount(n)) : p.caption}
        />
        <Tile
          label="Chiffre d'affaires"
          value={dash ?? money(current.cents, currency)}
          note={previous ? vs(current.cents, previous.cents, (n) => money(n, currency)) : p.caption}
        />
        <Tile
          label="En ligne maintenant"
          value={fmtCount(live?.online.total)}
          note="visiteurs actifs sur le site, toutes pages"
          to="/admin/stats"
          live
        />
        <Tile
          label="Visites aujourd'hui"
          value={fmtCount(visits)}
          note="visites du site depuis minuit (heure de Paris)"
          to="/admin/stats"
        />
      </div>

      <DailyRevenue days={data.days} currency={currency} />
    </section>
  );
}
