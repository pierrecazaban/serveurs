import { ScrollReveal } from "@/components/ui/ScrollReveal";

const howWeWorkImage = "/how-we-work.png";

export function Team() {
  return (
    <section id="team" className="py-16 md:py-24" style={{ background: "#E3EDE7" }}>
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <ScrollReveal>
          <div className="flex items-center gap-4 mb-10">
            <div className="w-8 h-[3px]" style={{ background: "#F28A4B" }} />
            <span className="text-[11px] font-semibold tracking-[0.3em] uppercase" style={{ color: "#305D55" }}>
              How we work
            </span>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={200}>
          <div className="relative mb-20 w-full max-w-4xl mx-auto">
            <img
              src={howWeWorkImage}
              alt="Workshop: mapping processes from operations to automation"
              className="w-full aspect-[3/2] object-cover"
              loading="lazy"
              width={1536}
              height={1024}
            />
            <div className="absolute bottom-0 left-0 w-24 h-1" style={{ background: "#F28A4B" }} />
          </div>
        </ScrollReveal>

        <div className="grid lg:grid-cols-2 gap-16 lg:gap-24">
          <div>
            <ScrollReveal delay={100}>
              <h2
                className="font-heading text-[34px] md:text-5xl lg:text-[52px] font-bold leading-[1.08] mb-10"
                style={{ color: "#1F3B36" }}
              >
                A core team,
                <br />
                an expert network
              </h2>
            </ScrollReveal>
            <ScrollReveal delay={300}>
              <p className="text-[15px] md:text-base leading-[1.85]" style={{ color: "#3A4F4A" }}>
                Reetma is led by its founders and a tight core team. Around it, we mobilise a{" "}
                <strong style={{ color: "#1F3B36" }}>network of specialised engineers and consultants</strong> in AI,
                data, cloud, product and business analysis, and assemble the team each project needs. We are
                transparent about who is employed, who is contracted and who leads. What we ship is{" "}
                <strong style={{ color: "#1F3B36" }}>production-grade:</strong> versioned, auditable, deployed
                through <strong style={{ color: "#1F3B36" }}>CI/CD pipelines</strong> on{" "}
                <strong style={{ color: "#1F3B36" }}>cloud infrastructure</strong> we operate.
              </p>
            </ScrollReveal>
            <ScrollReveal delay={400}>
              <div className="mt-10 p-6 rounded-2xl" style={{ background: "rgba(48,93,85,0.06)", border: "1px solid rgba(48,93,85,0.12)" }}>
                <p className="text-[11px] tracking-[0.25em] uppercase font-semibold mb-3" style={{ color: "#305D55" }}>
                  About Reetma
                </p>
                <div className="space-y-1.5 text-[13px] leading-relaxed" style={{ color: "#3A4F4A" }}>
                  <p><strong style={{ color: "#1F3B36" }}>Reetma,</strong> technology consulting in AI, data and cloud</p>
                  <p>Pierre Cazaban, sole proprietor (micro-entreprise)</p>
                  <p>SIREN: 132 067 414</p>
                </div>
              </div>
            </ScrollReveal>
          </div>

          <div className="space-y-0">
            {[
              {
                title: "CONSULTING & PROCESS DESIGN",
                desc: <>
                  We start with the process, not the technology.{" "}
                  <strong style={{ color: "#1F3B36" }}>Mapping,</strong>{" "}
                  <strong style={{ color: "#1F3B36" }}>task-level analysis,</strong>{" "}
                  <strong style={{ color: "#1F3B36" }}>automation potential</strong> and{" "}
                  <strong style={{ color: "#1F3B36" }}>ROI</strong> are documented before a line of code is written.
                </>,
              },
              {
                title: "ENGINEERING & CLOUD",
                desc: <>
                  <strong style={{ color: "#1F3B36" }}>Agent architectures</strong> (orchestration, RAG, vector
                  search, event-driven pipelines), <strong style={{ color: "#1F3B36" }}>data engineering</strong> and{" "}
                  <strong style={{ color: "#1F3B36" }}>multi-cloud infrastructure</strong> (AWS, Azure, GCP) with IaC,
                  encryption and RBAC. We integrate with what you already run.
                </>,
              },
              {
                title: "HUMAN-IN-THE-LOOP GOVERNANCE",
                desc: <>
                  Every agent output is a <strong style={{ color: "#1F3B36" }}>draft.</strong> No automated
                  action executes without <strong style={{ color: "#1F3B36" }}>explicit human validation.</strong>
                  Full traceability, audit logs, and <strong style={{ color: "#1F3B36" }}>role-based access control</strong> at
                  every step of the pipeline.
                </>,
              },
            ].map((item, i) => (
              <ScrollReveal key={item.title} delay={i * 200}>
                <div className="py-8" style={{ borderBottom: "1px solid rgba(48,93,85,0.15)" }}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-2 h-2 rounded-full" style={{ background: "#F28A4B" }} />
                    <span className="text-[11px] tracking-[0.25em] uppercase font-semibold" style={{ color: "#305D55" }}>{item.title}</span>
                  </div>
                  <p className="text-[15px] leading-[1.85]" style={{ color: "#3A4F4A" }}>{item.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
