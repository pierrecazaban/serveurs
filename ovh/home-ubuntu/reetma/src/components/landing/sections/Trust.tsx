import { ScrollReveal } from "@/components/ui/ScrollReveal";

const blocks = [
  { title: "HUMAN-IN-THE-LOOP BY DEFAULT", desc: "No agent executes an action without validation from your team. Every output is a draft with full traceability from source data to decision. Autonomy is widened only when you decide, process by process." },
  { title: "SECURITY & DATA PROTECTION", desc: "GDPR-compliant by design: data minimisation, encryption at rest and in transit, role-based access control, audit logs, EU hosting on request. We work under your security policies, not around them." },
  { title: "TRANSPARENT TEAM & STAFFING", desc: "You always know who is employed by Reetma, who is a contracted expert and who leads delivery. Profiles are presented with their real status, seniority and availability, and you approve the team." },
  { title: "READY FOR PROCUREMENT & TENDERS", desc: "Documented delivery process, technical proposals, references and security documentation prepared for RFPs and tenders. Ask us for our tender pack." },
];

export function Trust() {
  return (
    <section id="guarantees" className="py-16 md:py-24 bg-white">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <ScrollReveal>
          <div className="flex items-center gap-4 mb-10">
            <div className="w-8 h-[3px]" style={{ background: "#F28A4B" }} />
            <span className="text-[11px] font-semibold tracking-[0.3em] uppercase" style={{ color: "#305D55" }}>
              Delivery guarantees
            </span>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={200}>
          <h2
            className="font-heading text-[34px] md:text-5xl lg:text-[52px] font-bold leading-[1.08] mb-12"
            style={{ color: "#1F3B36" }}
          >
            Trust is not
            <br />
            a slide. It's how
            <br />
            we deliver
          </h2>
        </ScrollReveal>

        <div className="grid sm:grid-cols-2 gap-0">
          {blocks.map((b, i) => (
            <ScrollReveal key={b.title} delay={i * 180}>
              <div
                className="p-8 lg:p-10"
                style={{
                  borderRight: i % 2 === 0 ? "1px solid rgba(48,93,85,0.12)" : "none",
                  borderBottom: i < 2 ? "1px solid rgba(48,93,85,0.12)" : "none",
                }}
              >
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-2 h-2 rounded-full" style={{ background: "#F28A4B" }} />
                  <h3 className="font-heading text-[12px] font-bold tracking-[0.15em]" style={{ color: "#1F3B36" }}>{b.title}</h3>
                </div>
                <p className="text-[15px] leading-[1.85]" style={{ color: "#3A4F4A" }}>{b.desc}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
