import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollReveal } from "@/components/ui/ScrollReveal";

const faqs = [
  { q: "What exactly does Reetma do?", a: "We are a technology consulting firm. We map your processes, identify what can be automated, then design, build and run the AI agents, data pipelines, software and cloud infrastructure needed, with a team assembled for the project. We also place specialised AI, data and cloud profiles on a time-and-materials basis." },
  { q: "How does a first engagement start?", a: "With a free process audit: one or two workshops with the people who run the process, a task-level map, and a short report on what could be automated, the expected gains and a proposed plan. No commitment beyond that." },
  { q: "Do we need to replace our existing systems?", a: "No. We integrate with what you already run: ERP (SAP, Oracle, Dynamics), HRIS, WMS, email, spreadsheets and in-house tools, through APIs, connectors and, when needed, custom development." },
  { q: "How do you keep AI outputs safe and compliant?", a: "Every agent output is a draft validated by your team before anything is executed. Actions are logged, attributed and traceable to the source data. GDPR by design: data minimisation, pseudonymisation where possible, encryption at rest and in transit, RBAC, EU hosting on request. We can complete your vendor security questionnaires." },
  { q: "Who will actually work on our project?", a: "A core Reetma team leads every engagement. Around it we mobilise specialised engineers and consultants from our network, presented with their real status (employee, contractor, partner), seniority and availability. You approve the team before it starts." },
  { q: "Can you answer RFPs and public tenders?", a: "Yes. We respond with a documented delivery process, references, a technical proposal and the security and compliance documentation buyers require. When scale demands it, we partner with complementary firms and say so in the response." },
];

export function FAQ() {
  return (
    <section id="faq" className="py-16 md:py-24" style={{ background: "#EAF1EC" }}>
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <ScrollReveal>
          <div className="flex items-center gap-4 mb-10">
            <div className="w-8 h-[3px]" style={{ background: "#F28A4B" }} />
            <span className="text-[11px] font-semibold tracking-[0.3em] uppercase" style={{ color: "#305D55" }}>
              Practical questions
            </span>
          </div>
        </ScrollReveal>

        <div className="grid lg:grid-cols-2 gap-16 lg:gap-24">
          <div>
            <ScrollReveal delay={150}>
              <h2
                className="font-heading text-[34px] md:text-5xl lg:text-[52px] font-bold leading-[1.08] mb-6"
                style={{ color: "#1F3B36" }}
              >
                Frequently
                <br />
                asked questions
              </h2>
            </ScrollReveal>
            <ScrollReveal delay={300}>
              <p className="text-[15px] leading-[1.85]" style={{ color: "#4B5B58" }}>
                Everything your <strong style={{ color: "#1F3B36" }}>operations, IT and procurement</strong> teams
                need to know before working with us.
              </p>
            </ScrollReveal>
          </div>

          <div>
            <Accordion type="single" collapsible>
              {faqs.map((faq, i) => (
                <ScrollReveal key={i} delay={i * 120}>
                  <AccordionItem
                    value={`faq-${i}`}
                    className="border-b py-0"
                    style={{ borderColor: "#EEE8DD" }}
                  >
                    <AccordionTrigger
                      className="font-heading text-[15px] font-bold hover:no-underline py-6 text-left"
                      style={{ color: "#1F3B36" }}
                    >
                      {faq.q}
                    </AccordionTrigger>
                    <AccordionContent>
                      <p className="text-[14px] leading-[1.8] pb-4" style={{ color: "#5E6B67" }}>
                        {faq.a}
                      </p>
                    </AccordionContent>
                  </AccordionItem>
                </ScrollReveal>
              ))}
            </Accordion>
          </div>
        </div>
      </div>
    </section>
  );
}
