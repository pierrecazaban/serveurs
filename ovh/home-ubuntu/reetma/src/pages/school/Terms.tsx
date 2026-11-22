import { Seo } from "@/components/Seo";
import { Fill } from "@/components/school/Fill";
import { HelpCenterLink } from "@/components/school/HelpCenterLink";
import { INDEPENDENCE_NOTICE, schoolConfig } from "@/config/school";
import { SCHOOL_PATHS } from "@/lib/school/lang";
import { Link } from "react-router-dom";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="font-heading text-lg font-bold mb-3" style={{ color: "#1F3B36" }}>
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
        {children}
      </div>
    </section>
  );
}

export default function SchoolTerms() {
  return (
    <>
      <Seo
        title="Program terms | L'École by Reetma"
        description="The terms that apply to L'École, the student program run by Reetma: what the program is, who can register, price, refunds and liability."
        path="/school/terms"
        lang="en"
        alternates={{ en: "/school/terms", fr: "/ecole/conditions" }}
      />
      <div className="pt-32 pb-24 px-6 lg:px-12">
        <div className="max-w-3xl mx-auto">
          <h1 className="font-heading text-3xl font-bold mb-2" style={{ color: "#1F3B36" }}>
            Program terms
          </h1>
          <p className="text-sm mb-12" style={{ color: "#9AA49F" }}>
            Last updated {schoolConfig.lastUpdated} · Version {schoolConfig.termsVersion} ·{" "}
            <Link to={SCHOOL_PATHS.fr.terms} lang="fr" className="underline">
              Français
            </Link>
          </p>

          <Section title="Who runs the program">
            <p>
              L'École is run by <Fill value={schoolConfig.legalEntity} />. For any question about
              the program, open a request in our <HelpCenterLink />.
            </p>
          </Section>

          <Section title="What the program is">
            <p>
              L'École is an online training program. Students learn how AI is used at work and how to
              build their own AI agent.
            </p>
            <p>
              Right after payment, the student creates a password and immediately gets access to an
              online student space. It contains 3 training modules, followed at the student's own
              pace, and then an online final test.
            </p>
            <p>
              A student who answers at least 70% of the final test correctly immediately receives the
              digital certificate "AI Agents &amp; Workflow Automation – Certificate of Completion",
              issued by Reetma. Each certificate has its own number (RE-XXXXXX), can be verified online
              and can be added to the student's LinkedIn profile. A student who does not pass can take
              the test again, within the limit of attempts shown in the student space.
            </p>
          </Section>

          <Section title="Independence and academic credit">
            <p>{INDEPENDENCE_NOTICE}</p>
            <p>
              The certificate is a private certificate issued by Reetma once the final test is passed.
              It is not an academic credential and carries no university credit.
            </p>
          </Section>

          <Section title="Who can register">
            <p>
              Registration is open to people aged 18 or older who are current students with a valid
              student email address from one of the universities listed in the registration form.
            </p>
          </Section>

          <Section title="Price and payment">
            <p>
              The registration fee is {schoolConfig.price.display}, all taxes included, paid once online
              in euros through our payment provider, Stripe. It covers {schoolConfig.feeCovers} It is the only
              amount students pay.
            </p>
          </Section>

          <Section title="Seats and waitlist">
            <p>
              Each intake has a limited number of seats. When an intake is full, registration
              turns into a waitlist for the next one.
            </p>
          </Section>

          <Section title="Access and pace">
            <p>
              Access to the student space starts as soon as the student creates a password after
              payment. The 3 modules are followed at the student's own pace, and the final test can be
              taken once the 3 modules are completed.
            </p>
          </Section>

          <Section title="No right of withdrawal">
            <p>
              L'École is digital content that is not supplied on a physical medium and whose supply
              starts immediately after payment. Before paying, you tick a dedicated box by which you
              ask for access to start immediately and acknowledge that you therefore lose your right
              of withdrawal. You thereby waive any statutory cooling-off, withdrawal or cancellation
              right to the extent permitted by the consumer-protection law that applies to you, except
              where the law requires a refund regardless of that waiver.
            </p>
          </Section>

          <Section title="Refunds">
            <p>
              <Fill value={schoolConfig.refundPolicy} /> The full policy is on the{" "}
              <Link to="/school/refund-policy" className="underline" style={{ color: "#305D55" }}>
                refund policy page
              </Link>
              .
            </p>
          </Section>

          <Section title="Personal access and fair use">
            <p>
              Access to the student space is personal. Students must not share their password or the
              content of the student space with anyone else, must take the final test themselves and
              must not publish its questions. Reetma may suspend the access of a student who breaks
              these rules, without refund.
            </p>
          </Section>

          <Section title="Ownership of the agent you build">
            <p>
              <Fill value={schoolConfig.ipPolicy} />
            </p>
          </Section>

          <Section title="No promise of results">
            <p>
              L'École is a training program. It does not promise a job, an internship, an interview
              or any specific outcome.
            </p>
          </Section>

          <Section title="Limitation of liability">
            <p>
              To the extent permitted by law, Reetma's liability in connection with the program is
              limited to the registration fee paid by the student. Reetma is not liable for
              indirect losses such as lost opportunities or lost earnings.
            </p>
          </Section>

          <Section title="Governing law">
            <p>
              These terms are governed by the law of <Fill value={schoolConfig.jurisdiction} />.
            </p>
          </Section>

          <Section title="Changes to these terms">
            <p>
              Reetma may update these terms. The version that applies to a registration is the
              version accepted at the time of that registration, recorded with the registration.
            </p>
          </Section>
        </div>
      </div>
    </>
  );
}
