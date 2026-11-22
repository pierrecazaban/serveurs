import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Seo } from "@/components/Seo";
import { AgentDemo } from "@/components/school/AgentDemo";
import { RegistrationForm } from "@/components/school/RegistrationForm";
import { Fill } from "@/components/school/Fill";
import { HelpCenterLink } from "@/components/school/HelpCenterLink";
import { schoolConfig, schoolFeatures, schoolText } from "@/config/school";
import { PaymentsPaused } from "@/components/school/PaymentsPaused";
import { fetchPublicIntake, fetchUniversities, recordFunnelEvent } from "@/lib/school/api";
import { captureUtm } from "@/lib/school/tracking";
import { SCHOOL_PATHS, intakeLabel } from "@/lib/school/lang";
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

export default function Ecole() {
  const text = schoolText("fr");
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

  const primaryLabel = !isOpen ? "Être prévenu(e)" : isFull ? "Rejoindre la liste d'attente" : "Réserver ma place";

  return (
    <>
      <Seo
        title="L'École par Reetma | Obtenez votre certification IA en 3 heures"
        description="Accédez tout de suite à 3 modules en ligne, réussissez le test final et obtenez votre Certificat de réussite Reetma en IA."
        path="/ecole"
        image="https://reetma-agency.com/school-og.png?v=3h"
        lang="fr"
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
              name: "L'École par Reetma",
              description:
                "Obtenez votre certification IA en 3 heures grâce à 3 modules en ligne à suivre à votre rythme et un test final, centrés sur l'usage concret de l'IA au travail.",
              inLanguage: "fr",
              url: "https://reetma-agency.com/ecole",
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
              L'École <span className="text-muted-foreground">par Reetma</span>
              <Link to={SCHOOL_PATHS.en.home} lang="en" className="ml-3 text-xs font-semibold text-muted-foreground underline">
                English
              </Link>
            </p>
            <h1 className="mb-5 max-w-[680px] font-heading text-[40px] font-bold leading-[1.08] text-foreground sm:text-[54px] lg:text-[58px]">
              Construisez votre agent IA.
              <br />
              Obtenez votre certificat
              <br />
              en 3 heures.
            </h1>
            <p className="mb-7 max-w-[640px] text-base leading-[1.55] text-muted-foreground sm:text-lg">
              Accédez tout de suite à 3 modules en ligne pour découvrir comment l'IA est réellement
              utilisée au travail et construire votre propre agent IA, à votre rythme. Réussissez le
              test final et obtenez votre Certificat de réussite Reetma, à ajouter sur LinkedIn.
            </p>

            <div className="mb-7 grid max-w-[660px] gap-4 sm:grid-cols-3 sm:gap-5">
              {[
                { icon: Video, title: "3 modules en ligne", detail: "Accès immédiat, à votre rythme" },
                { icon: FileBadge2, title: "Aucune programmation", detail: "Ouvert à tous les profils" },
                { icon: GraduationCap, title: "Certificat après le test final", detail: "À ajouter sur LinkedIn" },
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
            <p className="text-xs font-semibold text-muted-foreground">À régler aujourd'hui</p>
            <div className="mt-1 flex items-end gap-3">
              <strong className="font-heading text-5xl text-primary">{text.priceDisplay}</strong>
              <span className="pb-2 text-sm font-bold text-primary">TTC de frais d'inscription</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Frais d'inscription uniques.
              <br />
              Le seul paiement demandé pour réserver votre place.
            </p>

            {schoolFeatures.payments ? (
              <Button type="button" onClick={scrollToRegister} size="lg" className="mt-6 h-14 w-full rounded-md text-base font-bold">
                Réserver ma place <ArrowRight aria-hidden="true" />
              </Button>
            ) : (
              <PaymentsPaused lang="fr" compact />
            )}

            <div className="mt-3 min-h-5 text-center text-xs text-muted-foreground">
              {intakeQuery.isLoading && <span className="inline-block h-3 w-48 animate-pulse rounded bg-muted" />}
              {intake && !isOpen && <span>Les inscriptions sont fermées pour le moment.</span>}
              {intake && isFull && <span>Cette promotion est complète. Rejoignez la liste d'attente.</span>}
              {intake && isOpen && !isFull && (
                <span>
                  Encore {seatsLeft} places sur {totalSeats} pour la promotion {intakeLabel(intake.name, "fr")}
                </span>
              )}
            </div>

            <div className="mt-6 grid grid-cols-3 gap-2 border-t border-border pt-5 text-center text-[10px] leading-tight text-muted-foreground">
              <span className="flex flex-col items-center gap-2"><LockKeyhole className="size-4 text-primary" />Paiement sécurisé</span>
              <span className="flex flex-col items-center gap-2"><Wifi className="size-4 text-primary" />Accès immédiat</span>
              <span className="flex flex-col items-center gap-2"><GraduationCap className="size-4 text-primary" />Indépendant de votre université</span>
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
            Réservez votre place
          </h2>
          {!schoolFeatures.payments ? (
            <PaymentsPaused lang="fr" />
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
            Agent minimaliste
          </h2>
          <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
            <div>
              <p className="text-lg leading-relaxed" style={{ color: "#4B5B58" }}>
                Pendant le programme, vous construisez un agent qui accomplit réellement une tâche pour
                vous. À la fin, vous pouvez montrer un exemple concret d'automatisation par l'IA, et pas
                seulement une attestation de suivi.
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
            Le marché du travail le demande déjà
          </h2>
          <div className="space-y-6">
            {text.marketEvidence.map((item, index) => (
              <div
                key={index}
                className="bg-white p-6"
                style={{ border: "1px solid #ECE5D9" }}
              >
                <p className="font-heading text-lg font-bold leading-snug" style={{ color: "#1F3B36" }}>
                  {item.headline}
                </p>
                <p className="mt-2 text-sm" style={{ color: "#6B7672" }}>
                  Source&nbsp;:{" "}
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
            La question n'est pas de savoir si l'IA comptera dans votre carrière, mais si vous pouvez
            prouver que vous savez vous en servir. Un certificat officiel transforme cette compétence
            en une preuve visible pour les recruteurs.
          </p>
        </div>
      </section>

      {/* 5. What you get */}
      <section className="py-20 px-6 lg:px-12" style={{ background: "#FBF7F0" }}>
        <div className="max-w-[1100px] mx-auto">
          <h2 className="font-heading text-2xl font-bold mb-10" style={{ color: "#1F3B36" }}>
            Ce que vous obtenez
          </h2>
          <div className="grid gap-10 lg:grid-cols-5">
            <div className="lg:col-span-3 bg-white p-8" style={{ border: "1px solid #ECE5D9" }}>
              <h3 className="font-heading text-xl font-bold mb-3" style={{ color: "#1F3B36" }}>
                Un certificat vérifiable par les recruteurs
              </h3>
              <p className="text-base leading-relaxed" style={{ color: "#4B5B58" }}>
                Vous l'obtenez en réussissant le test final après les 3 modules. C'est une référence
                tangible à faire figurer sur votre CV, votre profil LinkedIn et vos candidatures.
              </p>
            </div>
            <div className="lg:col-span-2 space-y-6">
              <div>
                <h3 className="font-heading text-base font-bold mb-2" style={{ color: "#1F3B36" }}>
                  3 modules en ligne, à votre rythme
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
                  L'usage de l'IA au travail, accessible dès votre inscription.
                </p>
              </div>
              <div>
                <h3 className="font-heading text-base font-bold mb-2" style={{ color: "#1F3B36" }}>
                  Certificat de réussite Reetma
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
                  Délivré dès que vous réussissez le test final. Ajoutez-le à votre CV et à LinkedIn : c'est une
                  référence concrète de Reetma qui montre aux recruteurs que vous savez construire avec
                  l'IA.
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
            Comment ça marche
          </h2>
          <ol className="space-y-6">
            {[
              "Inscrivez-vous en quelques minutes et consultez le récapitulatif avant de confirmer.",
              "Réglez les frais d'inscription et créez votre mot de passe : votre espace étudiant s'ouvre aussitôt.",
              "Suivez les 3 modules en ligne, à votre rythme.",
              "Passez le test final.",
              "Obtenez votre certificat et ajoutez-le sur LinkedIn.",
            ].map((step, index) => (
              <li key={index} className="flex gap-4">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ background: "#305D55" }}
                >
                  {index + 1}
                </span>
                <span className="text-base" style={{ color: "#4B5B58" }}>
                  {step}
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
            Les modules
          </h2>
          <ol className="space-y-5">
            {text.modules.map((session, index) => (
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
            Arrivez à votre prochain entretien avec des preuves : un agent IA fonctionnel que vous avez
            construit et un certificat Reetma que vous avez obtenu.
          </p>
        </div>
      </section>

      {/* 9. Is it for you */}
      <section className="pt-20 pb-10 px-6 lg:px-12" style={{ background: "#FBF7F0" }}>
        <div className="max-w-3xl mx-auto">
          <h2 className="font-heading text-2xl font-bold mb-6" style={{ color: "#1F3B36" }}>
            Est-ce pour vous ?
          </h2>
          <p className="text-base leading-relaxed mb-4" style={{ color: "#4B5B58" }}>
            <Fill value={text.prerequisites} />
          </p>
          <p className="text-base leading-relaxed" style={{ color: "#4B5B58" }}>
            L'École est ouverte aux étudiants des universités proposées dans le formulaire.
          </p>
        </div>
      </section>

      {/* 10. Instructors */}
      {schoolConfig.instructors.length > 0 && (
        <section className="py-20 px-6 lg:px-12">
          <div className="max-w-3xl mx-auto">
            <h2 className="font-heading text-2xl font-bold mb-8" style={{ color: "#1F3B36" }}>
              Formateurs
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
              <AccordionTrigger>Ce programme donne-t-il des crédits universitaires ?</AccordionTrigger>
              <AccordionContent>
                Non. Vous obtenez un Certificat de réussite Reetma, un certificat privé délivré par
                Reetma.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q2">
              <AccordionTrigger>Que couvrent les frais d'inscription ?</AccordionTrigger>
              <AccordionContent>
                Les {text.priceDisplay} de frais d'inscription, payés une seule fois, couvrent <Fill value={text.feeCovers} />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q3">
              <AccordionTrigger>Quand puis-je commencer ?</AccordionTrigger>
              <AccordionContent>
                Dès le paiement : vous créez votre mot de passe et votre espace étudiant s'ouvre
                aussitôt. Les 3 modules sont en ligne, à suivre à votre rythme.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q4">
              <AccordionTrigger>Comment obtenir le certificat ?</AccordionTrigger>
              <AccordionContent>
                Réussissez le test final à la fin des 3 modules (au moins 70 % de bonnes réponses).
                Votre certificat est délivré aussitôt, et vous pouvez l'ajouter à votre profil LinkedIn.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q5">
              <AccordionTrigger>Est-ce organisé par mon université ?</AccordionTrigger>
              <AccordionContent>Non. {text.independenceNotice}</AccordionContent>
            </AccordionItem>
            <AccordionItem value="q6">
              <AccordionTrigger>Puis-je être remboursé(e) ?</AccordionTrigger>
              <AccordionContent>
                <Fill value={text.refundPolicy} />{" "}
                <Link to={SCHOOL_PATHS.fr.refund} className="underline" style={FAQ_LINK_STYLE}>
                  Lire la politique de remboursement
                </Link>
                .
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q7">
              <AccordionTrigger>Faut-il savoir programmer ?</AccordionTrigger>
              <AccordionContent>
                <Fill value={text.prerequisites} />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q8">
              <AccordionTrigger>Que faites-vous de mes données ?</AccordionTrigger>
              <AccordionContent>
                Nous les utilisons uniquement pour organiser le programme et vous contacter à son
                sujet. Nous ne les communiquons jamais à votre université.{" "}
                <Link to="/legal/privacy" className="underline" style={FAQ_LINK_STYLE}>
                  Politique de confidentialité
                </Link>
                .
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q9">
              <AccordionTrigger>J'ai une autre question.</AccordionTrigger>
              <AccordionContent>
                Ouvrez une demande dans notre <HelpCenterLink /> : nous répondons à chaque demande par e-mail.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>

      {/* 12. L'École footer block */}
      <section className="py-14 px-6 lg:px-12">
        <div className="max-w-3xl mx-auto text-sm leading-relaxed" style={{ color: "#6B7672" }}>
          <p>L'École est le programme de formation de Reetma destiné aux étudiants.</p>
          <p className="mt-3">{text.independenceNotice}</p>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
            <Link to={SCHOOL_PATHS.fr.terms} className="underline" style={FAQ_LINK_STYLE}>
              Conditions du programme
            </Link>
            <Link to={SCHOOL_PATHS.fr.refund} className="underline" style={FAQ_LINK_STYLE}>
              Politique de remboursement
            </Link>
            <Link to="/legal/privacy" className="underline" style={FAQ_LINK_STYLE}>
              Politique de confidentialité
            </Link>
            <HelpCenterLink>Centre d'aide</HelpCenterLink>
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
            {text.priceDisplay} · accès immédiat
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
