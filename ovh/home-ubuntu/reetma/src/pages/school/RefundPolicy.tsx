import { Seo } from "@/components/Seo";
import { HelpCenterLink } from "@/components/school/HelpCenterLink";
import { schoolConfig } from "@/config/school";
import { SCHOOL_PATHS } from "@/lib/school/lang";
import { Link } from "react-router-dom";

const H2 = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-heading text-lg font-bold mb-2" style={{ color: "#1F3B36" }}>
    {children}
  </h2>
);

export default function SchoolRefundPolicy() {
  return (
    <>
      <Seo
        title="Refund policy | L'École by Reetma"
        description="L'École by Reetma is a digital product: online training modules, an online final test and a digital certificate. Purchases are non-refundable once access has started, except where the law requires otherwise."
        path="/school/refund-policy"
        lang="en"
        alternates={{ en: "/school/refund-policy", fr: "/ecole/remboursement" }}
      />
      <div className="pt-32 pb-24 px-6 lg:px-12">
        <div className="max-w-3xl mx-auto">
          <h1 className="font-heading text-3xl font-bold mb-2" style={{ color: "#1F3B36" }}>
            Refund policy
          </h1>
          <p className="text-sm mb-12" style={{ color: "#9AA49F" }}>
            Last updated {schoolConfig.lastUpdated} · Version {schoolConfig.termsVersion} ·{" "}
            <Link to={SCHOOL_PATHS.fr.refund} lang="fr" className="underline">
              Français
            </Link>
          </p>

          <div className="space-y-8 text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
            <div className="rounded-lg p-5" style={{ background: "#F5EFE5", border: "1px solid #ECE5D9" }}>
              <p className="font-semibold" style={{ color: "#1F3B36" }}>In short</p>
              <p className="mt-1">
                Everything you buy from L'École is digital. Because digital content cannot be
                "returned" once you have accessed it, purchases are <strong>final and
                non-refundable</strong>. You agree to this, and to waive your right of withdrawal,
                with a dedicated checkbox before you pay.
              </p>
            </div>

            <div>
              <H2>What you are buying</H2>
              <p>L'École is delivered entirely online. Your registration gives you:</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>
                  immediate access, right after payment, to your online student space and its 3
                  training modules, to follow at your own pace;
                </li>
                <li>the online final test, once the 3 modules are completed;</li>
                <li>
                  a digital certificate of completion issued by Reetma as soon as you pass the final
                  test (at least 70% correct answers), with its own number that can be verified online.
                </li>
              </ul>
              <p className="mt-2">Nothing is shipped and there is no physical product.</p>
            </div>

            <div>
              <H2>Why digital products are not refundable</H2>
              <p>
                A physical product can be sent back and resold. Digital content cannot: as soon as
                you receive access, you can view all the modules and take the final test, and your
                seat in a limited-size intake is taken from other students. A refund after access
                would mean giving the full program away.
              </p>
              <p className="mt-3">
                The law recognises this. Under EU consumer law (Article 16(m) of Directive
                2011/83/EU) and French law (Article L221-28, 13° of the Code de la consommation), the
                14-day right of withdrawal does not apply to digital content that is not supplied on
                a physical medium, once its supply has started with your prior express consent and
                your acknowledgement that you lose your right of withdrawal.
              </p>
            </div>

            <div>
              <H2>How you agree to this</H2>
              <p>Before payment, the registration form asks you to tick a box confirming that:</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>you ask for access to the digital content to start immediately; and</li>
                <li>you understand that you therefore lose your right of withdrawal.</li>
              </ul>
              <p className="mt-2">
                You cannot pay without ticking this box. The date and terms version of your
                agreement are recorded with your registration, and you can ask us for a copy at any
                time.
              </p>
            </div>

            <div>
              <H2>What is not refunded</H2>
              <ul className="list-disc pl-5 space-y-2">
                <li>Change of mind, or deciding the program is not the right fit.</li>
                <li>Not completing the modules, or not passing the final test.</li>
                <li>
                  Technical issues on your side (internet connection, device, browser settings)
                  while Reetma's platform is working normally.
                </li>
              </ul>
            </div>

            <div>
              <H2>When we do refund</H2>
              <p>Your statutory rights are not affected. You are refunded in full if:</p>
              <ul className="list-disc pl-5 space-y-2 mt-2">
                <li>
                  <strong>Reetma cannot give you access to your student space</strong> and cannot
                  fix it within a reasonable time.
                </li>
                <li>
                  <strong>You were charged by mistake</strong>, for example a duplicate payment.
                </li>
                <li>
                  <strong>The content does not match its description</strong> and we cannot fix it
                  within a reasonable time. You keep your legal guarantee of conformity for digital
                  content (Articles L224-25-12 and following of the Code de la consommation).
                </li>
              </ul>
            </div>

            <div>
              <H2>How to contact us</H2>
              <p>
                If you think one of these cases applies to you, open a request in our <HelpCenterLink /> with your
                registration reference (the code starting with ECO on your confirmation page and
                email). We reply within 5 business days. Approved refunds go back to the card or
                account used for payment; banks usually take 5 to 10 business days to show them.
              </p>
            </div>

            <div>
              <H2>Disputes</H2>
              <p>
                If we cannot resolve your request together, you can use the free consumer mediation
                service available in your country, or the remedies provided by the
                consumer-protection law of your country of residence.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
