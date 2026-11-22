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

export default function EcoleRemboursement() {
  return (
    <>
      <Seo
        title="Politique de remboursement | L'École by Reetma"
        description="L'École by Reetma est un produit numérique : modules de formation en ligne, test final en ligne et certificat numérique. Les achats ne sont pas remboursables une fois l'accès commencé, sauf lorsque la loi en dispose autrement."
        path="/ecole/remboursement"
        lang="fr"
        alternates={{ en: "/school/refund-policy", fr: "/ecole/remboursement" }}
      />
      <div className="pt-32 pb-24 px-6 lg:px-12">
        <div className="max-w-3xl mx-auto">
          <h1 className="font-heading text-3xl font-bold mb-2" style={{ color: "#1F3B36" }}>
            Politique de remboursement
          </h1>
          <p className="text-sm mb-12" style={{ color: "#9AA49F" }}>
            Dernière mise à jour : 26 octobre 2026 · Version {schoolConfig.termsVersion} ·{" "}
            <Link to={SCHOOL_PATHS.en.refund} lang="en" className="underline">
              English
            </Link>
          </p>

          <div className="space-y-8 text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
            <div className="rounded-lg p-5" style={{ background: "#F5EFE5", border: "1px solid #ECE5D9" }}>
              <p className="font-semibold" style={{ color: "#1F3B36" }}>En bref</p>
              <p className="mt-1">
                Tout ce que vous achetez auprès de L'École est numérique. Un contenu numérique ne
                pouvant pas être « retourné » une fois consulté, les achats sont <strong>définitifs et
                non remboursables</strong>. Vous l'acceptez, et renoncez à votre droit de rétractation,
                en cochant une case prévue à cet effet avant de payer.
              </p>
            </div>

            <div>
              <H2>Ce que vous achetez</H2>
              <p>L'École est entièrement dispensée en ligne. Votre inscription vous donne :</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>
                  l'accès immédiat, dès le paiement, à votre espace étudiant en ligne et à ses 3
                  modules de formation, à suivre à votre rythme ;
                </li>
                <li>le test final en ligne, une fois les 3 modules terminés ;</li>
                <li>
                  un certificat de réussite numérique délivré par Reetma dès la réussite du test final
                  (au moins 70 % de bonnes réponses), avec un numéro qui lui est propre et vérifiable en
                  ligne.
                </li>
              </ul>
              <p className="mt-2">Rien n'est expédié : il n'y a aucun produit physique.</p>
            </div>

            <div>
              <H2>Pourquoi les produits numériques ne sont pas remboursables</H2>
              <p>
                Un produit physique peut être renvoyé et revendu. Un contenu numérique ne le peut pas :
                dès que vous y avez accès, vous pouvez consulter tous les modules et passer le test
                final, et votre place dans une promotion à effectif limité n'est plus disponible pour
                d'autres étudiants. Rembourser après l'accès reviendrait à offrir l'intégralité du
                programme.
              </p>
              <p className="mt-3">
                La loi le reconnaît. En application du droit européen de la consommation (article 16,
                point m), de la directive 2011/83/UE) et du droit français (article L221-28, 13° du
                Code de la consommation), le droit de rétractation de 14 jours ne s'applique pas à la
                fourniture d'un contenu numérique non fourni sur un support matériel, dès lors que
                cette fourniture a commencé avec votre accord préalable exprès et après que vous avez
                reconnu perdre votre droit de rétractation.
              </p>
            </div>

            <div>
              <H2>Comment vous l'acceptez</H2>
              <p>Avant le paiement, le formulaire d'inscription vous demande de cocher une case confirmant que :</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>vous demandez que l'accès au contenu numérique commence immédiatement ;</li>
                <li>vous comprenez que vous perdez en conséquence votre droit de rétractation.</li>
              </ul>
              <p className="mt-2">
                Vous ne pouvez pas payer sans cocher cette case. La date de votre accord et la version
                des conditions acceptées sont enregistrées avec votre inscription, et vous pouvez nous
                en demander une copie à tout moment.
              </p>
            </div>

            <div>
              <H2>Ce qui n'est pas remboursé</H2>
              <ul className="list-disc pl-5 space-y-2">
                <li>Un changement d'avis, ou le sentiment que le programme ne vous convient pas.</li>
                <li>Des modules non terminés, ou un test final non réussi.</li>
                <li>
                  Des problèmes techniques de votre côté (connexion internet, appareil, réglages du
                  navigateur) alors que la plateforme de Reetma fonctionne normalement.
                </li>
              </ul>
            </div>

            <div>
              <H2>Quand nous remboursons</H2>
              <p>Vos droits légaux ne sont pas affectés. Vous êtes intégralement remboursé si :</p>
              <ul className="list-disc pl-5 space-y-2 mt-2">
                <li>
                  <strong>Reetma ne peut pas vous donner accès à votre espace étudiant</strong> et ne
                  peut pas y remédier dans un délai raisonnable.
                </li>
                <li>
                  <strong>Vous avez été débité par erreur</strong>, par exemple en cas de double
                  paiement.
                </li>
                <li>
                  <strong>Le contenu ne correspond pas à sa description</strong> et nous ne pouvons pas
                  y remédier dans un délai raisonnable. Vous conservez la garantie légale de conformité
                  applicable aux contenus numériques (articles L224-25-12 et suivants du Code de la
                  consommation).
                </li>
              </ul>
            </div>

            <div>
              <H2>Nous contacter</H2>
              <p>
                Si vous pensez que l'un de ces cas vous concerne, ouvrez une demande dans notre <HelpCenterLink /> en
                indiquant votre référence d'inscription (le code commençant par ECO, figurant sur votre
                page de confirmation et dans votre e-mail). Nous répondons sous 5 jours ouvrés. Les
                remboursements accordés sont reversés sur la carte ou le compte utilisé pour le
                paiement ; les banques mettent généralement 5 à 10 jours ouvrés à les faire apparaître.
              </p>
            </div>

            <div>
              <H2>Litiges</H2>
              <p>
                Si nous ne parvenons pas à résoudre votre demande ensemble, vous pouvez recourir
                gratuitement au service de médiation de la consommation disponible dans votre pays, ou
                aux voies de recours prévues par le droit de la consommation de votre pays de
                résidence.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
