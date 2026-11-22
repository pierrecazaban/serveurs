import { Link } from "react-router-dom";
import { SCHOOL_PATHS } from "@/lib/school/lang";

import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { trackClick } from "@/lib/track";

export function FinalCTA() {
  return (
    <section
      id="cta"
      className="relative py-20 md:py-28 overflow-hidden"
      style={{
        background: "linear-gradient(160deg, #305D55 0%, #305D55 50%, #305D55 100%)",
      }}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-[450px] h-[450px] rounded-full" style={{ background: "rgba(255,255,255,0.04)" }} />
        <div className="absolute -bottom-36 -left-36 w-[550px] h-[550px] rounded-full" style={{ background: "rgba(255,255,255,0.03)" }} />
      </div>
      <div className="relative max-w-[1400px] mx-auto px-6 lg:px-12 z-10">
        <ScrollReveal>
          <div className="w-12 h-[3px] bg-white/30 mb-12" />
        </ScrollReveal>

        <ScrollReveal delay={100}>
          <h2 className="font-heading text-[34px] md:text-5xl lg:text-[52px] font-bold leading-[1.08] text-white mb-6">
            Start with
            <br />
            one process
          </h2>
        </ScrollReveal>
        <ScrollReveal delay={200}>
          <p className="text-[15px] md:text-base max-w-[460px] mb-14 leading-[1.85]" style={{ color: "rgba(255,255,255,0.6)" }}>
            Book a <strong className="text-white font-medium">free process audit.</strong>
            We map one process with your team, <strong className="text-white font-medium">quantify what it costs,</strong>
            and show you what an <strong className="text-white font-medium">AI agent, an integration or a data pipeline</strong> would
            change, before you commit to anything.
          </p>
        </ScrollReveal>
        <ScrollReveal delay={300}>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link
              to={SCHOOL_PATHS.en.book}
              onClick={() => trackClick("process_audit")}
              className="inline-flex items-center justify-center h-14 px-10 text-[13px] font-bold tracking-[0.1em] uppercase text-[#305D55] bg-white transition-all hover:bg-white/90"
            >
              Process audit
            </Link>
            <Link
              to={SCHOOL_PATHS.en.book}
              onClick={() => trackClick("contact")}
              className="inline-flex items-center justify-center h-14 px-10 text-[13px] font-medium tracking-[0.1em] uppercase text-white border border-white/25 transition-all hover:bg-white/10"
            >
              Contact our team
            </Link>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
