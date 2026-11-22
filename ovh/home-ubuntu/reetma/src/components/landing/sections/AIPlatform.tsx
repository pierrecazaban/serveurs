import { ShieldCheck, Brain, Database, FileSearch, Activity, Shield, Eye, Users, Receipt, ChartColumn, Search, Bot } from "lucide-react";
import { ScrollReveal } from "@/components/ui/ScrollReveal";

export function AIPlatform() {
  return (
    <section id="method" className="py-16 md:py-24" style={{ background: "#1F3B36" }}>
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <ScrollReveal>
          <div className="flex items-center gap-4 mb-10">
            <div className="w-8 h-[3px]" style={{ background: "#F28A4B" }} />
            <span className="text-[11px] font-semibold tracking-[0.3em] uppercase" style={{ color: "#305D55" }}>
              Method & platform · Reetma Process Intelligence
            </span>
          </div>
        </ScrollReveal>

        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 mb-16">
          <div>
            <ScrollReveal>
              <h2 className="font-heading text-[32px] md:text-[44px] lg:text-[48px] font-bold leading-[1.08] mb-6 text-white">
                Reetma Process Intelligence
                <br />
                <span style={{ color: "#305D55" }}>One method, applied every time</span>
              </h2>
            </ScrollReveal>
            <ScrollReveal delay={150}>
              <p className="text-[14px] md:text-[15px] leading-[1.8]" style={{ color: "rgba(255,255,255,0.55)" }}>
                <strong className="text-white font-medium">Reetma Process Intelligence</strong> is the method we apply on every engagement:{" "}
                <strong className="text-white font-medium">map</strong> the process,{" "}
                <strong className="text-white font-medium">measure</strong> each task,{" "}
                <strong className="text-white font-medium">decide</strong> what to automate,{" "}
                <strong className="text-white font-medium">build</strong> the agents,{" "}
                <strong className="text-white font-medium">deploy</strong> into your stack and{" "}
                <strong className="text-white font-medium">measure</strong> again.
                It is documented, reproducible and increasingly tooled, the same approach that took a five-person process down to one for a client.
              </p>
            </ScrollReveal>
          </div>

          <div className="flex flex-col justify-center">
            <div className="space-y-0">
              {[
                { label: "Diagnostic deliverables", value: "Process map · ROI model" },
                { label: "Automation candidates scored on", value: "Hours · Errors · Risk" },
                { label: "Execution model", value: "Draft → human validation" },
                { label: "After go-live", value: "Run · Improve · Next process" },
              ].map((item, i) => (
                <ScrollReveal key={item.label} delay={i * 100}>
<div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <span className="text-[13px]" style={{ color: "rgba(255,255,255,0.5)" }}>{item.label}</span>
                    <span className="font-heading text-[14px] font-bold text-white sm:text-right">{item.value}</span>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </div>

        {/* Architecture Schema */}
        <ScrollReveal>
          <div className="rounded-xl p-6 md:p-10 lg:p-12" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="text-center mb-8">
              <span className="text-[10px] font-semibold tracking-[0.25em] uppercase" style={{ color: "#305D55" }}>
                Reetma Agentic Platform · architecture
              </span>
            </div>

            <div className="mb-3">
              <div className="text-[9px] font-semibold tracking-[0.2em] uppercase mb-2 text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
                Data ingestion
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {["Emails & PDFs", "ERP / EDI feeds", "HRIS & job boards", "Databases & APIs", "Spreadsheets & files"].map((s) => (
                  <div key={s} className="px-3 py-1.5 rounded text-[11px] font-medium" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)" }}>
                    {s}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-center py-2">
              <div className="w-px h-6" style={{ background: "rgba(242,138,75,0.3)" }} />
            </div>

            <div className="rounded-lg p-5 md:p-6 mb-3" style={{ background: "rgba(242,138,75,0.05)", border: "1px solid rgba(242,138,75,0.15)" }}>
              <div className="text-center mb-4">
                <span className="text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color: "#305D55" }}>
                  Reetma Core Engine
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: Brain, label: "LLM Orchestration" },
                  { icon: Database, label: "RAG Pipeline" },
                  { icon: FileSearch, label: "Vector Search" },
                ].map((m) => (
                  <div key={m.label} className="flex flex-col items-center gap-2 py-3 rounded-md" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <m.icon className="w-4 h-4" style={{ color: "#305D55" }} />
                    <span className="text-[10px] font-semibold text-white text-center leading-tight">{m.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-center py-2">
              <div className="w-px h-6" style={{ background: "rgba(242,138,75,0.3)" }} />
            </div>

            <div className="mb-3">
              <div className="text-[9px] font-semibold tracking-[0.2em] uppercase mb-2 text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
                Specialized agents
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                {[
                  { icon: Activity, label: "Operations", sub: "Order & document flows" },
                  { icon: Users, label: "Talent", sub: "Sourcing & scoring" },
                  { icon: Receipt, label: "Finance", sub: "Invoices & reconciliation" },
                  { icon: Shield, label: "Compliance", sub: "Controls & audit trail" },
                  { icon: ChartColumn, label: "Analytics", sub: "Reporting & KPIs" },
                  { icon: Eye, label: "Observability", sub: "Agent monitoring" },
                ].map((a) => (
                  <div key={a.label} className="flex flex-col items-center text-center gap-1.5 py-3 px-2 rounded-md" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <a.icon className="w-3.5 h-3.5" style={{ color: "#305D55" }} />
                    <span className="text-[10px] font-bold text-white leading-tight">{a.label}</span>
                    <span className="text-[9px] leading-tight" style={{ color: "rgba(255,255,255,0.4)" }}>{a.sub}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-center py-2">
              <div className="w-px h-6" style={{ background: "rgba(242,138,75,0.3)" }} />
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-3 py-3 px-3 rounded-md text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.12)" }}>
              <ShieldCheck className="w-4 h-4" style={{ color: "#305D55" }} />
              <span className="text-[11px] font-semibold text-white">Human-in-the-loop governance</span>
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>All outputs are drafts</span>
            </div>
          </div>
        </ScrollReveal>

        {/* Method Pillars */}
        <div className="mt-16">
          <ScrollReveal>
            <h3 className="font-heading text-[22px] md:text-[26px] font-bold leading-[1.15] mb-8 text-white">
              Built from delivery{" "}
              <span style={{ color: "rgba(255,255,255,0.45)" }}>Every tool comes from a real engagement</span>
            </h3>
          </ScrollReveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { icon: Search, title: "Process diagnostics", desc: "Task-level mapping of who does what, how long it takes and what it costs: the input to every automation decision." },
              { icon: Bot, title: "Agent design patterns", desc: "Reusable architectures for document, workflow and decision agents, with human validation built in." },
              { icon: ShieldCheck, title: "Governance & permissions", desc: "Role-based access, audit logs and approval flows so agents act only within the scope you define." },
              { icon: Activity, title: "Run & improve", desc: "Monitoring, performance measurement and continuous identification of the next process to automate." },
            ].map((p, i) => (
              <ScrollReveal key={p.title} delay={i * 100}>
                <div className="p-5 rounded-lg h-full" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="w-8 h-8 flex items-center justify-center rounded-md mb-3" style={{ background: "rgba(242,138,75,0.1)" }}>
                    <p.icon className="w-4 h-4" style={{ color: "#305D55" }} />
                  </div>
                  <h4 className="font-heading text-[13px] font-bold text-white mb-1.5">{p.title}</h4>
                  <p className="text-[12px] leading-[1.7]" style={{ color: "rgba(255,255,255,0.45)" }}>{p.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
