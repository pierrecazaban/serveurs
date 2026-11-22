import { ScrollReveal } from "@/components/ui/ScrollReveal";

const quality = [
  { value: "01", desc: "Map. Workshops and observation to document the process as it actually runs, task by task." },
  { value: "02", desc: "Measure. Hours, volumes, error rates, dependencies and cost per task." },
  { value: "03", desc: "Decide. What to automate, what to keep human, what to redesign: ROI and priority per candidate." },
  { value: "04", desc: "Build. Agents, integrations, data pipelines and infrastructure, inside your stack." },
  { value: "05", desc: "Deploy. Human-in-the-loop go-live, training, and measurement against the baseline." },
  { value: "06", desc: "Run. Monitoring, improvement and identification of the next process to transform." },
];

export function Methodology() {
  return (
    <section id="steps" className="py-16 md:py-24" style={{ background: "#EAF1EC" }}>
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <ScrollReveal>
          <div className="flex items-center gap-4 mb-10">
            <div className="w-8 h-[3px]" style={{ background: "#F28A4B" }} />
            <span className="text-[11px] font-semibold tracking-[0.3em] uppercase" style={{ color: "#305D55" }}>
              How an engagement runs
            </span>
          </div>
        </ScrollReveal>

        <div className="mb-20 max-w-[720px]">
          <ScrollReveal delay={150}>
            <h2
              className="font-heading text-[34px] md:text-5xl lg:text-[52px] font-bold leading-[1.08] mb-6"
              style={{ color: "#1F3B36" }}
            >
              One method.
              <br />
              Six steps
            </h2>
          </ScrollReveal>
          <ScrollReveal delay={350}>
            <p className="text-[15px] md:text-base leading-[1.85]" style={{ color: "#4B5B58" }}>
              Every engagement follows the same <strong style={{ color: "#1F3B36" }}>Reetma Process Intelligence</strong> cycle,
              from first workshop to agents in production. It is how we took a five-person process down to one for a
              client, and how we find the <strong style={{ color: "#1F3B36" }}>next process</strong> once the first one runs.
            </p>
          </ScrollReveal>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-0">
          {quality.map((q, i) => (
            <ScrollReveal key={q.desc} delay={i * 150}>
              <div
                className="p-8"
                style={{
                  borderRight: (i + 1) % 3 !== 0 ? "1px solid rgba(48,93,85,0.12)" : "none",
                  borderBottom: i < 3 ? "1px solid rgba(48,93,85,0.12)" : "none",
                }}
              >
                <div
                  className="font-heading text-[44px] md:text-[52px] lg:text-[58px] font-bold leading-none mb-3"
                  style={{ color: "#305D55" }}
                >
                  {q.value}
                </div>
                <p className="text-[13px] leading-[1.7]" style={{ color: "#5E6B67" }}>
                  {q.desc}
                </p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
