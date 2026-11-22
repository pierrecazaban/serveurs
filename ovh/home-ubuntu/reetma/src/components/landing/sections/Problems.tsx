import { Link } from "react-router-dom";
import { SCHOOL_PATHS } from "@/lib/school/lang";
import { ScrollReveal } from "@/components/ui/ScrollReveal";

const operationsWorkshop = "/operations-workshop-v2.png";
import { trackClick } from "@/lib/track";

const domains = [
  { name: "PROCESS AUTOMATION", tag: "Mapping · Agents · Workflows" },
  { name: "AGENTIC AI", tag: "LLM agents · RAG · Orchestration" },
  { name: "DOCUMENT INTELLIGENCE", tag: "PDF · Email · EDI · Scans" },
  { name: "DATA ENGINEERING", tag: "Pipelines · Warehousing · BI" },
  { name: "CLOUD & INFRASTRUCTURE", tag: "Migration · DevOps · Security" },
  { name: "SOFTWARE DEVELOPMENT", tag: "Web · APIs · Integrations" },
  { name: "ERP & SYSTEM INTEGRATION", tag: "SAP · Oracle · Dynamics" },
  { name: "EXPERT STAFFING", tag: "AI · Data · Cloud profiles" },
];

export function Problems() {
  return (
    <section id="operations" className="py-16 md:py-24 bg-white">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <ScrollReveal>
          <div className="flex items-center gap-4 mb-10">
            <div className="w-8 h-[3px]" style={{ background: "#F28A4B" }} />
            <span className="text-[11px] font-semibold tracking-[0.3em] uppercase" style={{ color: "#305D55" }}>
              Operational transformation
            </span>
          </div>
        </ScrollReveal>

        <div className="grid lg:grid-cols-2 gap-16 lg:gap-24">
          <div>
            <ScrollReveal delay={150}>
              <h2
                className="font-heading text-[34px] md:text-5xl lg:text-[52px] font-bold leading-[1.08] mb-10"
                style={{ color: "#1F3B36" }}
              >
                Your operations
                <br />
                deserve better
                <br />
                than spreadsheets
              </h2>
            </ScrollReveal>
            <ScrollReveal delay={350}>
              <div className="space-y-5 text-[15px] md:text-base leading-[1.85]" style={{ color: "#4B5B58" }}>
                <p>
                  Most organisations run on processes nobody designed:{" "}
                  <strong style={{ color: "#1F3B36" }}>manual re-entry,</strong>{" "}
                  <strong style={{ color: "#1F3B36" }}>disconnected tools,</strong>{" "}
                  <strong style={{ color: "#1F3B36" }}>tribal knowledge</strong> trapped in a few people.
                  Growth adds volume, headcount follows, margins don't.
                </p>
              </div>
            </ScrollReveal>
            <ScrollReveal delay={550}>
              <div className="space-y-5 text-[15px] md:text-base leading-[1.85]" style={{ color: "#4B5B58" }}>
                <p>
                  We work with operations, finance, HR and IT teams to identify the processes that{" "}
                  <strong style={{ color: "#1F3B36" }}>consume the most hours,</strong>{" "}
                  <strong style={{ color: "#1F3B36" }}>generate the most errors</strong> and{" "}
                  <strong style={{ color: "#1F3B36" }}>block scale,</strong> then we design, build and
                  run the automation that takes them over.
                </p>
              </div>
            </ScrollReveal>
            <ScrollReveal delay={750}>
              <div className="space-y-5 text-[15px] md:text-base leading-[1.85] mt-5" style={{ color: "#4B5B58" }}>
                <p>
                  The result:{" "}
                  <strong style={{ color: "#1F3B36" }}>your people focus on decisions,</strong> not
                  on copying data between systems, chasing missing documents or formatting reports
                  that should have been automated years ago.
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={900}>
              <div className="mt-12">
                <Link
                  to={SCHOOL_PATHS.en.book}
                  onClick={() => trackClick("process_audit")}
                  className="inline-flex items-center justify-center h-12 px-8 text-[13px] font-bold tracking-[0.1em] uppercase text-white transition-all hover:opacity-90"
                  style={{ background: "#305D55" }}
                >
                  Process audit
                </Link>
              </div>
            </ScrollReveal>
          </div>

          <div>
            <ScrollReveal delay={200}>
              <div className="relative mb-10 overflow-hidden">
                <img
                  src={operationsWorkshop}
                  alt="Operations transformation workshop"
                  className="w-full aspect-video object-cover"
                  loading="lazy"
                  width={1672}
                  height={941}
                />
              </div>
            </ScrollReveal>

            <ScrollReveal delay={250}>
              <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-8" style={{ color: "#9AA49F" }}>
                Domains of intervention
              </p>
            </ScrollReveal>
            <div className="space-y-0">
              {domains.map((d, i) => (
                <ScrollReveal key={d.name} delay={300 + i * 100}>
                  <a
                    href="#expertise"
                    className="flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between py-4 transition-opacity hover:opacity-60 group"
                    style={{ borderBottom: "1px solid #EEE8DD" }}
                  >
                    <span className="text-[15px] md:text-base font-heading font-bold tracking-[0.04em]" style={{ color: "#1F3B36" }}>
                      {d.name}
                    </span>
                    <span className="text-[11px] tracking-wider uppercase lg:text-right" style={{ color: "#9AA49F" }}>
                      {d.tag}
                    </span>
                  </a>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
