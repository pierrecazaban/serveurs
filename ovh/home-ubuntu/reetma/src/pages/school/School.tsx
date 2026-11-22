import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Seo } from "@/components/Seo";
import { AgentDemo } from "@/components/school/AgentDemo";
import { RegistrationForm } from "@/components/school/RegistrationForm";
import { Fill } from "@/components/school/Fill";
import { HelpCenterLink } from "@/components/school/HelpCenterLink";
import { SCHOOL_PATHS } from "@/lib/school/lang";
import { INDEPENDENCE_NOTICE, schoolConfig, schoolFeatures, isPlaceholder } from "@/config/school";
import { PaymentsPaused } from "@/components/school/PaymentsPaused";
import { fetchPublicIntake, fetchUniversities, recordFunnelEvent } from "@/lib/school/api";
import { captureUtm } from "@/lib/school/tracking";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Link } from "react-router-dom";
import { ArrowRight, FileBadge2, GraduationCap, LockKeyhole, Video, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";

const FAQ_LINK_STYLE = { color: "#305D55" } as const;

export default function School() {
  const registerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [registerVisible, setRegisterVisible] = useState(false);

  const intakeQuery = useQuery({ queryKey: ["school-intake"], queryFn: fetchPublicIntake });
  const universitiesQuery = useQuery({ queryKey: ["school-universities"], queryFn: fetchUniversities });

  const intake = intakeQuery.data ?? null;
  const isOpen = intake?.status === "open";
  const computedSeatsLeft = intake?.seats_left ?? 0;
  const totalSeats = schoolConfig.seatsDisplay?.total ?? intake?.capacity ?? 0;
  const seatsLeft = schoolConfig.seatsDisplay?.left ?? computedSeatsLeft;
  const isFull = isOpen && seatsLeft <= 0;

  useEffect(() => {
    captureUtm();
    recordFunnelEvent("school_view");
  }, []);

  useEffect(() => {
    const node = registerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setRegisterVisible(entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function scrollToRegister() {
    registerRef.current?.scrollIntoView({ behavior: "smooth" });
    window.setTimeout(() => {
      const heading = document.getElementById("register-heading");
      heading?.focus();
    }, 500);
  }

  const primaryLabel = !isOpen ? "Get notified" : isFull ? "Join the waitlist" : "Reserve my seat";

  return (
    <>
      <Seo
        title="L'École by Reetma | Get your AI certification in 3 hours"
        description="Get instant access to 3 online modules, pass the final test and earn your Reetma AI Certificate of Completion."
        path="/school"
        image="https://reetma-agency.com/school-og.png?v=3h"
        lang="en"
        alternates={{ en: "/school", fr: "/ecole" }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            {
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Reetma",
              url: "https://reetma-agency.com",
            },
            {
              "@context": "https://schema.org",
              "@type": "Course",
              name: "L'École by Reetma",
              description:
                "Earn your AI certification in 3 hours through 3 self-paced online modules and a final test, focused on real-world AI use at work.",
              provider: { "@type": "Organization", name: "Reetma", url: "https://reetma-agency.com" },
            },
          ]),
        }}
      />

      {/* 1. Hero */}
      <section className="school-page relative overflow-hidden border-b border-border bg-secondary px-5 pb-10 pt-28 sm:px-8 lg:px-12 lg:pb-12 lg:pt-28">
        <div className="school-grid pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-[1240px] gap-10 lg:grid-cols-[1.18fr_0.82fr] lg:items-center lg:gap-16">
          <div className="min-w-0">
            <p className="mb-6 font-heading text-sm font-bold text-primary">
              The School <span className="text-muted-foreground">by Reetma</span>
              <Link to={SCHOOL_PATHS.fr.home} lang="fr" className="ml-3 text-xs font-semibold text-muted-foreground underline">
                Français
              </Link>
            </p>
            <h1 className="mb-5 max-w-[680px] font-heading text-[40px] font-bold leading-[1.08] text-foreground sm:text-[54px] lg:text-[58px]">
              Build your AI agent.
              <br />
              Earn your certificate
              <br />
              in 3 hours.
            </h1>
            <p className="mb-7 max-w-[640px] text-base leading-[1.55] text-muted-foreground sm:text-lg">
              Get instant access to 3 online modules to learn how AI is really used at work and build
              your own AI agent, at your own pace. Pass the final test and receive your Reetma
              Certificate of Completion, ready to add to LinkedIn.
            </p>

            <div className="mb-7 grid max-w-[660px] gap-4 sm:grid-cols-3 sm:gap-5">
              {[
                { icon: Video, title: "3 online modules", detail: "Instant access, at your own pace" },
                { icon: FileBadge2, title: "No coding required", detail: "Open to all backgrounds" },
                { icon: GraduationCap, title: "Certificate after the final test", detail: "Add it to LinkedIn" },
              ].map(({ icon: Icon, title, detail }) => (
                <div key={title} className="flex items-center gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-[13px] leading-tight text-foreground">{title}</strong>
                    <span className="mt-1 block text-[11px] leading-tight text-muted-foreground">{detail}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <aside className="school-funding-card relative mx-auto w-full max-w-[450px] border border-border bg-card p-7 sm:p-8 lg:mx-0 lg:self-start lg:mt-7">
            <p className="text-xs font-semibold text-muted-foreground">Due today</p>
            <div className="mt-1 flex items-end gap-3">
              <strong className="font-heading text-5xl text-primary">{schoolConfig.price.display}</strong>
              <span className="pb-2 text-sm font-bold text-primary">registration fee, all taxes included</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              One-time registration fee.
              <br />
              The only payment required to reserve your seat.
            </p>

            {schoolFeatures.payments ? (
              <Button type="button" onClick={scrollToRegister} size="lg" className="mt-6 h-14 w-full rounded-md text-base font-bold">
                Reserve my seat <ArrowRight aria-hidden="true" />
              </Button>
            ) : (
              <PaymentsPaused lang="en" compact />
            )}

            <div className="mt-3 min-h-5 text-center text-xs text-muted-foreground">
              {intakeQuery.isLoading && <span className="inline-block h-3 w-48 animate-pulse rounded bg-muted" />}
              {intake && !isOpen && <span>Registration is closed for now.</span>}
              {intake && isFull && <span>This intake is full. Join the waitlist.</span>}
              {intake && isOpen && !isFull && (
                <span>{seatsLeft} of {totalSeats} seats left for {intake.name}</span>
              )}
            </div>

            <div className="mt-6 grid grid-cols-3 gap-2 border-t border-border pt-5 text-center text-[10px] leading-tight text-muted-foreground">
              <span className="flex flex-col items-center gap-2"><LockKeyhole className="size-4 text-primary" />Secure payment</span>
              <span className="flex flex-col items-center gap-2"><Wifi className="size-4 text-primary" />Instant access</span>
              <span className="flex flex-col items-center gap-2"><GraduationCap className="size-4 text-primary" />Independent from your university</span>
            </div>
          </aside>
        </div>
      </section>

      {/* 2. Registration */}
      <section id="register" ref={registerRef} className="py-20 px-6 lg:px-12" style={{ background: "#FBF7F0" }}>
        <div className="max-w-2xl mx-auto">
          <h2
            id="register-heading"
            tabIndex={-1}
            className="font-heading text-2xl font-bold mb-8 outline-none"
            style={{ color: "#1F3B36" }}
          >
            Reserve your seat
          </h2>
          {!schoolFeatures.payments ? (
            <PaymentsPaused lang="en" />
          ) : universitiesQuery.isLoading ? (
            <div className="h-48 animate-pulse rounded" style={{ background: "#F5EFE5" }} />
          ) : (
            <RegistrationForm intake={intake} universities={universitiesQuery.data ?? []} />
          )}
        </div>
      </section>

      {/* 3. Minimalist agent */}
      <section className="py-20 px-6 lg:px-12">
        <div className="max-w-[1100px] mx-auto">
          <h2 className="font-heading text-2xl font-bold mb-10" style={{ color: "#1F3B36" }}>
            A minimalist agent
          </h2>
          <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
            <div>
              <p className="text-lg leading-relaxed" style={{ color: "#4B5B58" }}>
                During the program you build an agent that actually does a task for you. By the end
                you can show a concrete example of AI automation, not just a course completion.
              </p>
            </div>
            <AgentDemo />
          </div>
        </div>
      </section>

      {/* 4. Why it matters */}
      <section className="py-20 px-6 lg:px-12">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-heading text-2xl font-bold mb-8" style={{ color: "#1F3B36" }}>
            The job market is already asking for this
          </h2>
          <div className="space-y-6">
            {schoolConfig.marketEvidence.map((item, index) => (
              <div
                key={index}
                className="bg-white p-6"
                style={{ border: "1px solid #ECE5D9" }}
              >
                <p className="font-heading text-lg font-bold leading-snug" style={{ color: "#1F3B36" }}>
                  {item.headline}
                </p>
                <p className="mt-2 text-sm" style={{ color: "#6B7672" }}>
                  Source:{" "}
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                    style={FAQ_LINK_STYLE}
                  >
                    {item.source}
                  </a>
                </p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-lg leading-relaxed" style={{ color: "#4B5B58" }}>
            The question isn't whether AI will matter in your career. It is whether you can prove you
            know how to use it. An official certificate turns that skill into evidence employers can
            see.
          </p>
        </div>
      </section>

      {/* 5. What you get */}
      <section className="py-20 px-6 lg:px-12" style={{ background: "#FBF7F0" }}>
        <div className="max-w-[1100px] mx-auto">
          <h2 className="font-heading text-2xl font-bold mb-10" style={{ color: "#1F3B36" }}>
            What you get
          </h2>
          <div className="grid gap-10 lg:grid-cols-5">
            <div className="lg:col-span-3 bg-white p-8" style={{ border: "1px solid #ECE5D9" }}>
              <h3 className="font-heading text-xl font-bold mb-3" style={{ color: "#1F3B36" }}>
                A certificate employers can verify
              </h3>
              <p className="text-base leading-relaxed" style={{ color: "#4B5B58" }}>
                You earn it by passing the final test after the 3 modules. It's a concrete credential
                to list on your resume, LinkedIn and job applications.
              </p>
            </div>
            <div className="lg:col-span-2 space-y-6">
              <div>
                <h3 className="font-heading text-base font-bold mb-2" style={{ color: "#1F3B36" }}>
                  3 online modules, at your own pace
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
                  How AI is used at work, available as soon as you register.
                </p>
              </div>
              <div>
                <h3 className="font-heading text-base font-bold mb-2" style={{ color: "#1F3B36" }}>
                  Reetma Certificate of Completion
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
                  Issued as soon as you pass the final test. Add it to your résumé and LinkedIn. It's a
                  practical credential from Reetma that shows employers you can build with AI.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. How it works */}
      <section ref={timelineRef} className="py-20 px-6 lg:px-12">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-heading text-2xl font-bold mb-10" style={{ color: "#1F3B36" }}>
            How it works
          </h2>
          <ol className="space-y-6">
            {[
              "Register in a few minutes and review the summary before confirming.",
              "Pay the registration fee and create your password: your student space opens right away.",
              "Follow the 3 online modules at your own pace.",
              "Pass the final test.",
              "Get your certificate and add it to LinkedIn.",
            ].map((text, index) => (
              <li key={index} className="flex gap-4">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ background: "#305D55" }}
                >
                  {index + 1}
                </span>
                <span className="text-base" style={{ color: "#4B5B58" }}>
                  {text}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 7. The modules */}
      <section className="py-20 px-6 lg:px-12" style={{ background: "#FBF7F0" }}>
        <div className="max-w-3xl mx-auto">
          <h2 className="font-heading text-2xl font-bold mb-10" style={{ color: "#1F3B36" }}>
            The modules
          </h2>
          <ol className="space-y-5">
            {schoolConfig.modules.map((session, index) => (
              <li key={index} className="flex gap-4 items-baseline">
                <span className="font-heading text-sm font-bold" style={{ color: "#305D55" }}>
                  {index + 1}
                </span>
                <span className="text-base" style={{ color: "#4B5B58" }}>
                  <Fill value={session} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 8. Picture your next interview */}
      <section className="py-20 px-6 lg:px-12">
        <div className="max-w-3xl mx-auto">
          <p className="font-heading text-2xl sm:text-3xl font-bold leading-snug" style={{ color: "#1F3B36" }}>
            Walk into your next interview with proof: a working AI agent you built and a Reetma certificate you earned.
          </p>
        </div>
      </section>

      {/* 9. Is it for you */}
      <section className="pt-20 pb-10 px-6 lg:px-12" style={{ background: "#FBF7F0" }}>
        <div className="max-w-3xl mx-auto">
          <h2 className="font-heading text-2xl font-bold mb-6" style={{ color: "#1F3B36" }}>
            Is it for you?
          </h2>
          <p className="text-base leading-relaxed mb-4" style={{ color: "#4B5B58" }}>
            <Fill value={schoolConfig.prerequisites} />
          </p>
          <p className="text-base leading-relaxed" style={{ color: "#4B5B58" }}>
            L'École is open to students of the universities listed in the form.
          </p>
        </div>
      </section>

      {/* 10. Instructors */}
      {schoolConfig.instructors.length > 0 && (
        <section className="py-20 px-6 lg:px-12">
          <div className="max-w-3xl mx-auto">
            <h2 className="font-heading text-2xl font-bold mb-8" style={{ color: "#1F3B36" }}>
              Instructors
            </h2>
            <div className="grid gap-8 sm:grid-cols-2">
              {schoolConfig.instructors.map((person) => (
                <div key={person.name}>
                  <p className="font-heading text-base font-bold" style={{ color: "#1F3B36" }}>
                    {person.name}
                  </p>
                  <p className="text-sm" style={{ color: "#6B7672" }}>
                    {person.role}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 11. FAQ */}
      <section className="pt-10 pb-20 px-6 lg:px-12" style={{ background: "#FBF7F0" }}>
        <div className="max-w-3xl mx-auto">
          <h2 className="font-heading text-2xl font-bold mb-8" style={{ color: "#1F3B36" }}>
            Questions
          </h2>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="q1">
              <AccordionTrigger>Will I get university credit?</AccordionTrigger>
              <AccordionContent>
                No. You get a Reetma Certificate of Completion, a private certificate issued by
                Reetma.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q2">
              <AccordionTrigger>What does the registration fee cover?</AccordionTrigger>
              <AccordionContent>
                The {schoolConfig.price.display} registration fee, paid once, covers <Fill value={schoolConfig.feeCovers} />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q3">
              <AccordionTrigger>When can I start?</AccordionTrigger>
              <AccordionContent>
                Right after payment: you create your password and your student space opens immediately.
                The 3 modules are online, at your own pace.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q4">
              <AccordionTrigger>How do I get the certificate?</AccordionTrigger>
              <AccordionContent>
                Pass the final test at the end of the 3 modules (at least 70% correct answers). Your
                certificate is issued right away and you can add it to your LinkedIn profile.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q5">
              <AccordionTrigger>Is this organized by my university?</AccordionTrigger>
              <AccordionContent>No. {INDEPENDENCE_NOTICE}</AccordionContent>
            </AccordionItem>
            <AccordionItem value="q6">
              <AccordionTrigger>Can I get a refund?</AccordionTrigger>
              <AccordionContent>
                <Fill value={schoolConfig.refundPolicy} />{" "}
                <Link to="/school/refund-policy" className="underline" style={FAQ_LINK_STYLE}>
                  Read the refund policy
                </Link>
                .
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q7">
              <AccordionTrigger>Do I need to know how to code?</AccordionTrigger>
              <AccordionContent>
                <Fill value={schoolConfig.prerequisites} />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q8">
              <AccordionTrigger>What do you do with my data?</AccordionTrigger>
              <AccordionContent>
                We use it only to run the program and contact you about it. We never share it with
                your university.{" "}
                <Link to="/legal/privacy" className="underline" style={FAQ_LINK_STYLE}>
                  Privacy policy
                </Link>
                .
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q9">
              <AccordionTrigger>I have another question.</AccordionTrigger>
              <AccordionContent>
                Open a request in our <HelpCenterLink />: we answer every request by email.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>

      {/* 12. L'École footer block */}
      <section className="py-14 px-6 lg:px-12">
        <div className="max-w-3xl mx-auto text-sm leading-relaxed" style={{ color: "#6B7672" }}>
          <p>L'École (French for "the school") is Reetma's training program for students.</p>
          <p className="mt-3">{INDEPENDENCE_NOTICE}</p>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
            <Link to="/school/terms" className="underline" style={FAQ_LINK_STYLE}>
              Program terms
            </Link>
            <Link to="/school/refund-policy" className="underline" style={FAQ_LINK_STYLE}>
              Refund policy
            </Link>
            <Link to="/legal/privacy" className="underline" style={FAQ_LINK_STYLE}>
              Privacy policy
            </Link>
            <HelpCenterLink>Help center</HelpCenterLink>
          </div>
        </div>
      </section>

      {/* Mobile sticky bar */}
      {schoolFeatures.payments && !registerVisible && (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between gap-4 px-4 py-3 md:hidden"
          style={{ background: "#FFFFFF", borderTop: "1px solid #ECE5D9" }}
        >
          <span className="text-sm font-semibold" style={{ color: "#1F3B36" }}>
            {schoolConfig.price.display} · instant access
          </span>
          <button
            type="button"
            onClick={scrollToRegister}
            className="px-5 py-2.5 text-sm font-semibold text-white"
            style={{ background: "#305D55" }}
          >
            {primaryLabel}
          </button>
        </div>
      )}
    </>
  );
}
