// "Who is where, right now": every page people are on, the busiest first, so nothing hides behind a tooltip (the
// Mollie payment page always has its row). The registration form is counted under L'École's page, "dont n dans le
// formulaire"; its steps are in the tooltip, and read out by screen readers.
import { BarList, BarTip, type BarItem } from "./StatsUi";
import { INK, fmtCount, formNote, type OnlinePage } from "./statsApi";

const people = (n: number) => (n > 1 ? "personnes" : "personne");

export function OnlinePages({ pages }: { pages: OnlinePage[] }) {
  const ranked = pages.filter((p) => p.count > 0).sort((a, b) => b.count - a.count);
  if (!ranked.length) {
    return (
      <p className="px-2 py-10 text-center text-sm" style={{ color: INK.muted }}>
        Personne en ligne pour l'instant
      </p>
    );
  }
  const items: BarItem[] = ranked.map((p) => {
    const note = formNote(p);
    const steps = p.form ?? [];
    const inForm = steps.reduce((sum, s) => sum + s.count, 0);
    const rows = steps.map((s): [string, string] => [fmtCount(s.count), s.label]);
    if (inForm && p.count > inForm) rows.unshift([fmtCount(p.count - inForm), "hors du formulaire"]);
    return {
      key: p.key,
      label: p.label,
      count: p.count,
      note: note || undefined,
      srText: note ? `(${steps.map((s) => `${s.label} : ${fmtCount(s.count)}`).join(" ; ")})` : people(p.count),
      tip: <BarTip title={p.label} value={fmtCount(p.count)} rows={rows} />,
    };
  });
  // Room after the longest bar for its value and, on L'École's page, the form note.
  return <BarList items={items} label="Pages consultées en ce moment" valueSpace={items.some((i) => i.note) ? "13rem" : "3rem"} />;
}
