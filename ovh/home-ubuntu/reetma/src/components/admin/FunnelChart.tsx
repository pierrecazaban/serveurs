// L'École sales funnel for the back office, as a frieze: one step per stage, in the order the API gives, with just
// the number of people at that stage. Left to right on a wide screen, top to bottom on a phone.
import { Fragment } from "react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { Panel } from "./StatsUi";
import { INK, RULE, fmtCount, type StatsCount } from "./statsApi";

export function FunnelChart({ stages, caption, dim }: { stages: StatsCount[]; caption: string; dim: boolean }) {
  return (
    <Panel>
      <div className="border-b px-4 py-3" style={{ borderColor: RULE }}>
        <p className="text-sm" style={{ color: INK.secondary }}>
          Nombre de personnes à chaque étape, {caption}
        </p>
      </div>
      <div className="p-3 transition-opacity sm:p-4" style={{ opacity: dim ? 0.45 : 1 }} aria-busy={dim}>
        <ol aria-label={`Tunnel de vente, ${caption}`} className="flex flex-col items-stretch gap-1 lg:flex-row">
          {stages.map((s, i) => (
            <Fragment key={s.key}>
              {i > 0 && (
                <li aria-hidden="true" className="flex shrink-0 justify-center lg:self-center" style={{ color: INK.muted }}>
                  <ArrowDown className="h-4 w-4 lg:hidden" />
                  <ArrowRight className="hidden h-4 w-4 lg:block" />
                </li>
              )}
              <li
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 lg:min-w-0 lg:flex-1 lg:basis-0 lg:flex-col lg:items-center lg:justify-start lg:px-2 lg:py-3 lg:text-center"
                style={{ borderColor: RULE, background: "#FFFFFF" }}
              >
                <span className="text-sm leading-snug lg:order-2 lg:text-xs" style={{ color: INK.secondary }}>{s.label}</span>
                <span className="text-lg font-bold tabular-nums lg:order-1 lg:text-xl" style={{ color: INK.primary }}>
                  {fmtCount(s.count)}
                </span>
              </li>
            </Fragment>
          ))}
        </ol>
      </div>
    </Panel>
  );
}
