import { ScrollReveal } from "@/components/ui/ScrollReveal";

const stats = [
  { value: "5 → 1", label: "People", sub: "on one critical process after automation, at a client" },
  { value: "~20 FTE", label: "Optimised", sub: "workload perimeter addressed across the engagement" },
  { value: "0", label: "Unvalidated", sub: "actions. Every output is checked by your team before it runs" },
];

export function Stats() {
  return (
    <section id="stats" className="py-16 md:py-24" style={{ background: "#EAF1EC" }}>
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <ScrollReveal>
          <div className="mb-14">
            <p className="text-base md:text-[17px] leading-[1.85] max-w-[620px]" style={{ color: "#4B5B58" }}>
              We don't sell software licences. We work inside your
              <strong style={{ color: "#1F3B36" }}> existing systems,</strong> from ERP and HRIS to email and back-office tools, to remove manual steps. Every automated output is a
              <strong style={{ color: "#1F3B36" }}> draft validated by your team,</strong> running on{" "}
              <strong style={{ color: "#1F3B36" }}>cloud infrastructure</strong> we design, deploy and operate.
            </p>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-y-14 gap-x-8">
          {stats.map((s, i) => (
            <ScrollReveal key={s.label} delay={i * 200}>
              <div className="relative pl-6">
                <div className="w-8 h-[3px] mb-6" style={{ background: "#F28A4B" }} />
                <div
                  className="font-heading text-[52px] md:text-[64px] lg:text-[72px] font-bold leading-none mb-2"
                  style={{ color: "#305D55" }}
                >
                  {s.value}
                </div>
                <div className="text-sm font-heading font-bold mb-1" style={{ color: "#1F3B36" }}>
                  {s.label}
                </div>
                <div className="text-[13px]" style={{ color: "#6B7672" }}>
                  {s.sub}
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
