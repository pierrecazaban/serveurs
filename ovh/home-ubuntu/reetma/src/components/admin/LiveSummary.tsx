// /admin at a glance: who is where right now and today's funnel, from the stats the page already polls every 30 s.
// The detail (every page, the whole funnel over a period) is one click away in Statistiques, in the same tab: the
// admin session lives in this tab only, a new tab would ask to sign in again.
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { INK, RULE, fmtCount, formNote, type Stats } from "./statsApi";

// The funnel stages worth a glance (keys of STAGES in api/track.js).
const GLANCE = ["visit", "form_start", "checkout", "paid"];

export function LiveSummary({ stats }: { stats: Stats }) {
  const pages = stats.online.pages.filter((p) => p.count > 0).sort((a, b) => b.count - a.count);
  const stages = stats.funnel.stages.filter((s) => GLANCE.includes(s.key));
  return (
    <div className="space-y-1.5 rounded-lg border bg-white px-4 py-3 text-sm" style={{ borderColor: RULE, color: INK.secondary }}>
      <p>
        <span className="font-semibold" style={{ color: INK.primary }}>En ce moment :</span>{" "}
        {pages.length
          ? pages
              .map((p) => {
                const note = formNote(p);
                return `${p.label} : ${fmtCount(p.count)}${note ? `, ${note}` : ""}`;
              })
              .join(" · ")
          : "personne en ligne."}
      </p>
      <p>
        <span className="font-semibold" style={{ color: INK.primary }}>Aujourd'hui :</span>{" "}
        {stages.map((s) => `${s.label} : ${fmtCount(s.count)}`).join(" · ")}
      </p>
      <Link
        to="/admin/stats"
        className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline focus-visible:underline"
        style={{ color: "#305D55" }}
      >
        Détail par page et tunnel complet dans Statistiques <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}
