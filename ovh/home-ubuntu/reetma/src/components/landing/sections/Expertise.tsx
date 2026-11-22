import { ScrollReveal } from "@/components/ui/ScrollReveal";

const areas = [
  { id: "process-automation", title: "PROCESS & AUTOMATION CONSULTING", desc: "Process mapping, task-level analysis and automation roadmaps. We quantify hours, error rates and cost per process, prioritise by ROI, and hand you a plan you can execute, with us or without us." },
  { id: "agentic-ai", title: "AGENTIC AI ENGINEERING", desc: "Design and build of AI agents that read documents, extract data, draft actions and route decisions to your team. Orchestration, retrieval-augmented generation and evaluation pipelines, integrated into your existing systems." },
  { id: "data-analytics", title: "DATA ENGINEERING & ANALYTICS", desc: "Pipelines, warehousing and reporting that give your operations a reliable single source of truth. From spreadsheet exports to governed data platforms, with dashboards your teams actually use." },
  { id: "cloud", title: "CLOUD & INFRASTRUCTURE", desc: "Migration from legacy on-premise systems to cloud-native infrastructure. Multi-cloud (AWS, Azure, GCP), infrastructure as code, security, monitoring and disaster recovery, designed, deployed and operated." },
  { id: "software", title: "SOFTWARE DEVELOPMENT & INTEGRATION", desc: "Custom applications, APIs and connectors around your ERP, HRIS, WMS and email systems. SAP, Oracle, Microsoft Dynamics or in-house platforms. No rip-and-replace." },
  { id: "staffing", title: "EXPERT STAFFING & MANAGED TEAMS", desc: "Rapid mobilisation of AI engineers, data engineers, cloud architects and product managers, on a project or time-and-materials basis. We assemble and lead the team; you always know who is employed, contracted or partnered." },
];

export function Expertise() {
  return (
    <section id="expertise" className="py-16 md:py-24 bg-white" style={{ borderTop: "1px solid #ECE5D9" }}>
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <ScrollReveal>
          <div className="flex items-center gap-4 mb-10">
            <div className="w-8 h-[3px]" style={{ background: "#F28A4B" }} />
            <span className="text-[11px] font-semibold tracking-[0.3em] uppercase" style={{ color: "#305D55" }}>
              What we do
            </span>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={200}>
          <h2
            className="font-heading text-[34px] md:text-5xl lg:text-[52px] font-bold leading-[1.08] mb-12"
            style={{ color: "#1F3B36" }}
          >
            Consulting, engineering
            <br />
            and staffing
          </h2>
        </ScrollReveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-0">
          {areas.map((a, i) => (
            <ScrollReveal key={a.title} delay={i * 150}>
              <div
                id={a.id}
                className="group cursor-default h-full flex flex-col p-8 transition-colors hover:bg-[#FBF6EE]"
                style={{
                  borderRight: (i + 1) % 3 !== 0 ? "1px solid #EEE8DD" : "none",
                  borderBottom: i < 3 ? "1px solid #EEE8DD" : "none",
                }}
              >
                <div className="w-6 h-[2px] mb-6" style={{ background: "#F28A4B" }} />
                <h3
                  className="font-heading text-[12px] font-bold tracking-[0.15em] mb-4"
                  style={{ color: "#1F3B36" }}
                >
                  {a.title}
                </h3>
                <p className="text-[14px] leading-[1.8]" style={{ color: "#5E6B67" }}>
                  {a.desc}
                </p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
