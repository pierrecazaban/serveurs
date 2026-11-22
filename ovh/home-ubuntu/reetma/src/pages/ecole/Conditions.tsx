import { Seo } from "@/components/Seo";
import { Fill } from "@/components/school/Fill";
import { HelpCenterLink } from "@/components/school/HelpCenterLink";
import { schoolConfig, schoolText } from "@/config/school";
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

export default function EcoleConditions() {
  const text = schoolText("fr");
  return (
    <>
      <Seo
        title="Conditions du programme | L'École by Reetma"
        description="Les conditions applicables à L'École, le programme étudiant organisé par Reetma : contenu du programme, conditions d'inscription, prix, remboursements et responsabilité."
        path="/ecole/conditions"
        lang="fr"
        alternates={{ en: "/school/terms", fr: "/ecole/conditions" }}
      />
      <div className="pt-32 pb-24 px-6 lg:px-12">
        <div className="max-w-3xl mx-auto">
          <h1 className="font-heading text-3xl font-bold mb-2" style={{ color: "#1F3B36" }}>
            Conditions du programme
          </h1>
          <p className="text-sm mb-12" style={{ color: "#9AA49F" }}>
            Dernière mise à jour : 26 octobre 2026 · Version {schoolConfig.termsVersion} ·{" "}
            <Link to={SCHOOL_PATHS.en.terms} lang="en" className="underline">
              English
            </Link>
          </p>

          <Section title="Qui organise le programme">
            <p>
              L'École est organisée par <Fill value={schoolConfig.legalEntity} />. Pour toute
              question relative au programme, ouvrez une demande dans notre <HelpCenterLink />.
            </p>
          </Section>

          <Section title="En quoi consiste le programme">
            <p>
              L'École est un programme de formation en ligne. Les étudiants y apprennent comment l'IA
              est utilisée au travail et comment construire leur propre agent IA.
            </p>
            <p>
              Dès le paiement, l'étudiant crée un mot de passe et accède immédiatement à un espace
              étudiant en ligne. Celui-ci contient 3 modules de formation, suivis au rythme de
              l'étudiant, puis un test final en ligne.
            </p>
            <p>
              L'étudiant qui répond correctement à au moins 70 % du test final reçoit immédiatement le
              certificat numérique « AI Agents &amp; Workflow Automation – Certificate of Completion »,
              délivré par Reetma. Chaque certificat porte un numéro qui lui est propre (RE-XXXXXX), est
              vérifiable en ligne et peut être ajouté au profil LinkedIn de l'étudiant. L'étudiant qui
              échoue peut repasser le test, dans la limite de tentatives indiquée dans l'espace
              étudiant.
            </p>
          </Section>

          <Section title="Indépendance et crédits universitaires">
            <p>{text.independenceNotice}</p>
            <p>
              Le certificat est un certificat privé délivré par Reetma dès la réussite du test final.
              Il ne constitue pas un titre universitaire et ne donne droit à aucun crédit
              universitaire.
            </p>
          </Section>

          <Section title="Qui peut s'inscrire">
            <p>
              L'inscription est ouverte aux personnes âgées de 18 ans ou plus, actuellement
              étudiantes et titulaires d'une adresse e-mail étudiante valide de l'une des universités
              figurant dans le formulaire d'inscription.
            </p>
          </Section>

          <Section title="Prix et paiement">
            <p>
              Les frais d'inscription s'élèvent à {text.priceDisplay} TTC (toutes taxes comprises), réglés en
              une seule fois en ligne, en euros, via notre prestataire de paiement Stripe. Ils couvrent{" "}
              {text.feeCovers} C'est le seul montant payé par les étudiants.
            </p>
          </Section>

          <Section title="Places et liste d'attente">
            <p>
              Chaque promotion dispose d'un nombre limité de places. Lorsqu'une promotion est
              complète, l'inscription devient une inscription sur liste d'attente pour la suivante.
            </p>
          </Section>

          <Section title="Accès et rythme">
            <p>
              L'accès à l'espace étudiant commence dès que l'étudiant crée son mot de passe, après le
              paiement. Les 3 modules se suivent au rythme de l'étudiant, et le test final peut être
              passé une fois les 3 modules terminés.
            </p>
          </Section>

          <Section title="Absence de droit de rétractation">
            <p>
              L'École est un contenu numérique non fourni sur un support matériel, dont la fourniture
              commence immédiatement après le paiement. Avant de payer, vous cochez une case prévue à
              cet effet par laquelle vous demandez que l'accès commence immédiatement et reconnaissez
              perdre en conséquence votre droit de rétractation. Vous renoncez ainsi à tout droit légal
              de rétractation, de réflexion ou d'annulation, dans la mesure permise par le droit de la
              consommation qui vous est applicable, sauf lorsque la loi impose un remboursement malgré
              cette renonciation.
            </p>
          </Section>

          <Section title="Remboursements">
            <p>
              <Fill value={text.refundPolicy} /> La politique complète figure sur la{" "}
              <Link to={SCHOOL_PATHS.fr.refund} className="underline" style={{ color: "#305D55" }}>
                page de la politique de remboursement
              </Link>
              .
            </p>
          </Section>

          <Section title="Accès personnel et usage loyal">
            <p>
              L'accès à l'espace étudiant est personnel. L'étudiant ne doit partager ni son mot de
              passe ni le contenu de son espace étudiant avec qui que ce soit, doit passer lui-même le
              test final et ne doit pas en publier les questions. Reetma peut suspendre l'accès d'un
              étudiant qui enfreint ces règles, sans remboursement.
            </p>
          </Section>

          <Section title="Propriété de l'agent que vous construisez">
            <p>
              <Fill value={text.ipPolicy} />
            </p>
          </Section>

          <Section title="Aucune garantie de résultat">
            <p>
              L'École est un programme de formation. Elle ne garantit ni emploi, ni stage, ni
              entretien, ni aucun résultat particulier.
            </p>
          </Section>

          <Section title="Limitation de responsabilité">
            <p>
              Dans la mesure permise par la loi, la responsabilité de Reetma au titre du programme est
              limitée au montant des frais d'inscription payés par l'étudiant. Reetma n'est pas
              responsable des préjudices indirects, tels que la perte d'opportunités ou un manque à
              gagner.
            </p>
          </Section>

          <Section title="Droit applicable">
            <p>
              Les présentes conditions sont régies par le droit applicable en{" "}
              <Fill value={schoolConfig.jurisdiction} />.
            </p>
          </Section>

          <Section title="Modification des présentes conditions">
            <p>
              Reetma peut modifier les présentes conditions. La version applicable à une inscription
              est celle acceptée au moment de cette inscription, enregistrée avec celle-ci.
            </p>
          </Section>
        </div>
      </div>
    </>
  );
}
