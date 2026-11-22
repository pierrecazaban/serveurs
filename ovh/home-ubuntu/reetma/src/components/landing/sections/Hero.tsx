const opsControlRoom = "/ops-control-room.png";
import { ScrollReveal } from "@/components/ui/ScrollReveal";

export function Hero() {
  return (
    <section
      id="hero"
      className="relative min-h-screen flex items-center overflow-hidden"
      style={{
        background: "linear-gradient(160deg, #FFFCF7 0%, #FBF5EC 55%, #F4F1E6 100%)",
      }}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-20 right-[8%] w-[480px] h-[480px] rounded-full" style={{ background: "rgba(242,138,75,0.10)" }} />
        <div className="absolute top-[20%] right-[2%] w-[340px] h-[340px] rounded-full" style={{ background: "rgba(47,174,120,0.10)" }} />
        <div className="absolute bottom-[5%] right-[18%] w-[280px] h-[280px] rounded-full" style={{ background: "rgba(242,138,75,0.08)" }} />
        <div className="absolute -bottom-40 -left-40 w-[600px] h-[600px] rounded-full" style={{ background: "rgba(47,174,120,0.07)" }} />
      </div>

      <div className="absolute top-[18%] right-[6%] w-[300px] h-[300px] lg:w-[420px] lg:h-[420px] rounded-full overflow-hidden hidden md:block opacity-90 shadow-xl">
        <img src={opsControlRoom} alt="" className="w-full h-full object-cover" />
      </div>

      <div className="relative max-w-[1400px] mx-auto px-6 lg:px-12 w-full z-10 pt-44 pb-36">
        <div className="max-w-[820px]">
          <ScrollReveal delay={200}>
            <p className="text-xs font-semibold tracking-[0.35em] uppercase text-[#F28A4B] mb-8">
              Agentic AI · Process Automation · Data & Cloud
            </p>
          </ScrollReveal>
          <ScrollReveal delay={500}>
            <h1 className="font-heading text-5xl sm:text-6xl md:text-7xl lg:text-[92px] font-bold leading-[1.02] tracking-tight text-[#305D55] mb-10">
              We transform
              <br />
              operations with
              <br />
              agentic AI
            </h1>
          </ScrollReveal>
          <ScrollReveal delay={800}>
            <p className="text-lg md:text-xl text-[#4B5B58] max-w-[540px] leading-relaxed">
              <strong className="text-[#305D55] font-semibold">Reetma</strong> is a technology consulting firm.
              We map your processes, identify what can be automated, then design, build and run the{" "}
              <strong className="text-[#305D55] font-semibold">AI agents,</strong>{" "}
              <strong className="text-[#305D55] font-semibold">data pipelines</strong> and{" "}
              <strong className="text-[#305D55] font-semibold">cloud infrastructure</strong> that do the work,
              with the specialised team each project needs.
            </p>
          </ScrollReveal>
        </div>
      </div>

    </section>
  );
}
