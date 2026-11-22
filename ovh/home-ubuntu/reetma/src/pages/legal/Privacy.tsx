import { useEffect, useRef, useState } from "react";
import { HelpCenterLink } from "@/components/school/HelpCenterLink";
import { Seo } from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { isTrackingOptedOut, setTrackingOptOut } from "@/lib/track";

interface PolicyItem {
  subtitle: string;
  text: string;
  /** Labelled points listed under the text. */
  details?: { label: string; text: string }[];
  /** Shows the audience-measurement opt-out under the item. */
  optOut?: boolean;
}

const sections: { title: string; items: PolicyItem[] }[] = [
  {
    title: "1. Responsable du traitement",
    items: [
      { subtitle: "Identité", text: "Reetma, nom commercial de Pierre Cazaban, entrepreneur individuel (micro-entreprise). SIREN : 132 067 414. Adresse : 74 rue du Mas de Caze, 34090 Montpellier, France." },
      { subtitle: "Contact", text: "Pour toute question relative à la protection de vos données personnelles, ouvrez une demande dans notre centre d'aide (reetma-agency.com/aide). Les coordonnées complètes de Reetma figurent dans les mentions légales." },
    ]
  },
  {
    title: "2. Données collectées",
    items: [
      { subtitle: "Données que vous fournissez", text: "Lorsque vous créez un compte, demandez une démonstration ou nous contactez, nous collectons des informations telles que votre nom, adresse email, nom d'entreprise, fonction, et toute autre information que vous choisissez de fournir." },
      { subtitle: "Espace étudiant de L'École", text: "Pour chaque étudiant inscrit : nom, adresse e-mail, numéro de téléphone, université, filière et année de diplôme si renseignées, comment vous nous avez connus, source de campagne (utm_source) par laquelle vous êtes arrivé, accord pour les communications marketing, référence d'inscription, mot de passe (conservé uniquement sous forme chiffrée et irréversible), progression dans les modules, résultats du test final et certificat délivré (son numéro et sa date sont vérifiables publiquement via le lien du certificat)." },
      { subtitle: "Centre d'aide", text: "Lorsque vous ouvrez une demande : votre nom, votre adresse e-mail, votre message, nos réponses et, le cas échéant, votre référence d'inscription." },
      { subtitle: "Mesure d'audience (Vercel Web Analytics)", text: "Pour connaître la fréquentation du site, nous utilisons Vercel Web Analytics. Pour chaque page consultée sont enregistrés : la page (son adresse, sans numéro de certificat ni paramètres, à l'exception des paramètres de campagne utm_*, qui sont gardés), le site d'origine, le pays, le type d'appareil, le système et le navigateur. Aucun cookie n'est déposé et vous n'êtes pas reconnu d'un jour à l'autre : un identifiant technique, calculé à partir de votre requête et renouvelé chaque jour, sert uniquement à compter les visites. Ces statistiques anonymes sont produites pour notre seul compte et ne requièrent pas de consentement au sens des recommandations de la CNIL ; vous pouvez vous y opposer avec le bouton ci-dessous." },
      {
        subtitle: "Mesure d'audience interne",
        text: "Pour savoir combien de visiteurs sont en ligne et sur quelles pages, et jusqu'où va le parcours d'inscription à L'École, le site envoie aussi quelques informations à notre propre serveur : à chaque changement de page, puis toutes les minutes tant que l'onglet est affiché (envoi suspendu après 3 minutes sans activité).",
        details: [
          { label: "Données envoyées", text: "un identifiant de visite tiré au hasard, gardé dans le stockage de session de votre navigateur et effacé à la fermeture de l'onglet (au clic sur « Payer », une copie en est aussi gardée pour votre retour : voir « Cookies ») ; l'adresse de la page consultée, sans ses paramètres (d'une page de certificat ou d'une adresse inconnue, seul le type de page est gardé) ; l'étape du formulaire d'inscription où vous vous trouvez et celles que vous avez franchies, clic sur « Payer » compris ; la langue de L'École (d'après l'adresse) ; l'horodatage." },
          { label: "Ni cookie, ni adresse IP", text: "aucun cookie n'est déposé et votre adresse IP n'est pas enregistrée : notre serveur ne s'en sert qu'en mémoire, pour limiter les abus (nombre d'envois par adresse)." },
          { label: "Paiements", text: "chaque paiement réussi d'une inscription à L'École est aussi compté, à partir de la notification que notre prestataire de paiement (Stripe) envoie à notre serveur : il est enregistré sous une empreinte de l'identifiant du paiement, sans lien avec votre visite, avec la langue de l'inscription et la date, et gardé 13 mois au plus. Ce comptage, comme celui des comptes créés, des modules terminés et des certificats délivrés (lus dans l'espace étudiant), ne passe pas par votre navigateur et ne dépend donc pas du bouton « Ne plus être compté sur ce navigateur »." },
          { label: "Pas de recoupement", text: "ces données ne sont croisées avec aucun autre fichier ni transmises à des tiers." },
          { label: "Finalité", text: "uniquement des statistiques agrégées, pour notre seul compte : le nombre de visiteurs en ligne par page, le nombre de visites du site et le tunnel d'inscription (combien de visites franchissent chaque étape, puis combien de paiements aboutissent)." },
          { label: "Conservation", text: "48 heures au plus pour la présence en ligne, 13 mois au plus pour les étapes du parcours et les paiements comptés." },
          { label: "Base légale", text: "notre intérêt légitime à mesurer l'audience du site (article 6.1.f du RGPD). Cette mesure est exemptée de consentement au sens des lignes directrices de la CNIL sur la mesure d'audience (article 82 de la loi Informatique et Libertés) ; vous pouvez vous y opposer à tout moment avec le bouton ci-dessous. Ce choix vaut aussi pour Vercel Web Analytics et pour la source de campagne d'une inscription (voir « Cookies »), et reste enregistré dans ce navigateur." },
        ],
        optOut: true,
      },
      { subtitle: "Cookies", text: "Le site n'utilise qu'un seul cookie, strictement nécessaire : le cookie de connexion de l'espace étudiant (reetma_session), déposé quand vous vous connectez pour vous garder connecté pendant 30 jours au plus, et supprimé à la déconnexion. Il ne sert à aucun suivi ni à aucune publicité. Les mesures d'audience ne déposent aucun cookie : l'identifiant de visite de la mesure interne reste dans le stockage de session de l'onglet (reetma_vid), effacé à sa fermeture. Au clic sur « Payer », il est aussi copié, avec l'heure, dans le stockage local de ce navigateur (reetma_vid_mollie) : si vous revenez sur la page de confirmation dans un autre onglet (depuis l'application de votre banque, par exemple), celle-ci reprend la même visite au lieu de vous compter deux fois. Cette copie ne contient rien du paiement et ne sert que 10 minutes : elle est effacée dès que la visite reprend ou que vous refusez d'être compté, sinon lors de votre première visite sur le site après ces 10 minutes. Votre éventuel refus d'être compté est retenu dans le stockage local de ce navigateur (reetma_no_track). L'espace d'administration garde une session de connexion dans l'onglet ouvert (stockage de session), effacée à sa fermeture ; s'y connecter enregistre en outre dans ce navigateur le refus d'être compté (reetma_no_track). Le stockage de session de l'onglet garde aussi le formulaire d'inscription en cours (school_form_state, school_reservation), pour ne pas le perdre en cas de rechargement. La source de campagne de l'adresse par laquelle vous arrivez sur L'École (paramètre utm_source) n'est, elle, pas enregistrée dans votre navigateur : la page la garde seulement en mémoire pour l'envoyer avec votre inscription. Elle est conservée avec celle-ci, pour savoir quelles campagnes amènent des inscrits, et n'est pas envoyée si vous avez refusé d'être compté." },
    ]
  },
  {
    title: "3. Finalités du traitement",
    items: [
      { subtitle: "Fourniture du service", text: "Nous utilisons vos données pour fournir, maintenir et améliorer les services REETMA, y compris le traitement de vos demandes et l'assistance client." },
      { subtitle: "Communication", text: "Nous pouvons utiliser votre email pour vous envoyer des mises à jour de service et des alertes de sécurité. Les communications marketing ne sont envoyées qu'avec votre consentement préalable." },
      { subtitle: "Analyses et amélioration", text: "Nous mesurons la fréquentation du site (visiteurs en ligne par page, parcours d'inscription) et comptons les paiements réussis, les comptes créés, les modules terminés et les certificats délivrés, pour améliorer le site et L'École. Chaque paiement réussi est compté à partir de la notification de notre prestataire de paiement, sous une empreinte de l'identifiant du paiement sans lien avec la visite, gardée 13 mois ; comptes, modules et certificats sont lus dans l'espace étudiant. Ces comptages ne dépendent pas du bouton « Ne plus être compté sur ce navigateur » (voir « Mesure d'audience interne »). Ces analyses ne portent que sur des statistiques agrégées." },
      { subtitle: "Obligations légales", text: "Nous pouvons utiliser vos données pour nous conformer à nos obligations légales, faire respecter nos conditions d'utilisation et protéger la sécurité de notre plateforme." },
    ]
  },
  {
    title: "4. Base juridique du traitement",
    items: [
      { subtitle: "Consentement", text: "Pour les communications marketing et les cookies non essentiels (article 6.1.a du RGPD)." },
      { subtitle: "Exécution du contrat", text: "Pour la fourniture de nos services et la gestion de votre compte (article 6.1.b du RGPD)." },
      { subtitle: "Intérêt légitime", text: "Pour la mesure d'audience, l'amélioration de nos services et la prévention de la fraude (article 6.1.f du RGPD)." },
      { subtitle: "Obligation légale", text: "Pour le respect de nos obligations fiscales et réglementaires (article 6.1.c du RGPD)." },
    ]
  },
  {
    title: "5. Partage et divulgation des données",
    items: [
      { subtitle: "Nous ne vendons pas vos données", text: "Reetma ne vend, ne loue ni n'échange vos informations personnelles à des tiers à des fins commerciales." },
      { subtitle: "Sous-traitants", text: "OVH SAS (France) héberge le site. Neon Inc. héberge notre base de données dans l'Union européenne (Francfort) : comptes étudiants, progression, certificats, demandes d'aide et mesure d'audience interne. Stripe Payments Europe, Ltd. (Irlande) traite les paiements de L'École : les informations d'inscription des étudiants sont conservées avec le paiement chez Stripe. Les inscriptions payées avant novembre 2026 l'ont été via Mollie B.V. (Pays-Bas), qui conserve les informations de ces paiements. Resend Inc. (États-Unis) envoie les e-mails du site (confirmation d'inscription, nouveau mot de passe, certificat, réponses du centre d'aide), dans le cadre de son accord de traitement des données." },
      { subtitle: "Obligations légales", text: "Nous pouvons divulguer des informations lorsque la loi l'exige, sur décision de justice, ou pour protéger les droits et la sécurité de Reetma et de ses utilisateurs." },
    ]
  },
  {
    title: "6. Sécurité des données",
    items: [
      { subtitle: "Chiffrement", text: "Toutes les données sont chiffrées en transit (TLS) et au repos (AES-256)." },
      { subtitle: "Contrôles d'accès", text: "Nous mettons en œuvre des contrôles d'accès stricts, garantissant que seul le personnel autorisé peut accéder aux données des utilisateurs." },
    ]
  },
  {
    title: "7. Vos droits (RGPD)",
    items: [
      { subtitle: "Droit d'accès", text: "Vous avez le droit d'accéder à vos données personnelles et d'en obtenir une copie (article 15 du RGPD)." },
      { subtitle: "Droit de rectification", text: "Vous pouvez demander la correction de données inexactes ou incomplètes (article 16 du RGPD)." },
      { subtitle: "Droit à l'effacement", text: "Vous pouvez demander la suppression de vos données personnelles (article 17 du RGPD)." },
      { subtitle: "Droit à la portabilité", text: "Vous pouvez recevoir vos données dans un format structuré et couramment utilisé (article 20 du RGPD)." },
      { subtitle: "Droit d'opposition", text: "Vous pouvez vous opposer au traitement de vos données à tout moment (article 21 du RGPD)." },
      { subtitle: "Droit de retirer votre consentement", text: "Lorsque le traitement repose sur votre consentement, vous pouvez le retirer à tout moment sans affecter la licéité du traitement antérieur." },
      { subtitle: "Réclamation auprès de la CNIL", text: "Si vous estimez que le traitement de vos données constitue une violation du RGPD, vous pouvez introduire une réclamation auprès de la CNIL (www.cnil.fr)." },
    ]
  },
];

const highlights = ["RGPD", "Pas de revente de données", "Droit à l'oubli", "Chiffrement en transit et au repos"];

/** Opt-out of both audience measurements (Vercel Web Analytics and the internal one), kept in this browser. */
function TrackingOptOut() {
  const [optedOut, setOptedOut] = useState(isTrackingOptedOut);
  const [unsaved, setUnsaved] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Opened from the link that /admin/stats gives for other devices (#ne-plus-etre-compte): show the button at once.
  useEffect(() => {
    if (window.location.hash === "#ne-plus-etre-compte") box.current?.scrollIntoView({ block: "center" });
  }, []);

  const toggle = () => {
    setTrackingOptOut(!optedOut);
    // Read the choice back: it cannot be kept when the browser blocks storage.
    const now = isTrackingOptedOut();
    setUnsaved(now === optedOut);
    setOptedOut(now);
  };

  return (
    <div
      id="ne-plus-etre-compte"
      ref={box}
      className="mt-4 p-4 rounded-xl border border-border bg-secondary/40 flex flex-col sm:flex-row sm:items-center gap-3"
    >
      <p role="status" className="flex-1 text-sm text-foreground leading-relaxed">
        {optedOut
          ? "État actuel : ce navigateur n'est pas compté dans la mesure d'audience."
          : "État actuel : ce navigateur est compté dans la mesure d'audience."}
        {unsaved && " Votre navigateur bloque le stockage local : ce choix ne peut pas être enregistré."}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={toggle}
        className="shrink-0 h-auto min-h-9 py-2 whitespace-normal bg-background"
      >
        {optedOut ? "Être à nouveau compté" : "Ne plus être compté sur ce navigateur"}
      </Button>
    </div>
  );
}

export default function Privacy() {
  return (
    <div className="pt-20">
      <Seo
        title="Politique de confidentialité | Reetma"
        description="Comment Reetma collecte, utilise et protège vos données personnelles, conformément au RGPD."
        path="/legal/privacy"
        lang="fr"
      />
      {/* Hero */}
      <section className="pt-16 pb-10 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-muted-foreground mb-5">Legal</p>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-foreground tracking-tight leading-[1.08]">Politique de Confidentialité</h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            La protection de vos données personnelles est au cœur de nos engagements.
          </p>
          <p className="mt-3 text-xs text-muted-foreground/60">Dernière mise à jour : 26 octobre 2026</p>
        </div>
      </section>

      {/* Highlights */}
      <section className="pb-10 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex flex-wrap justify-center gap-3">
            {highlights.map((h) => (
              <span key={h} className="px-4 py-2 rounded-full text-xs font-medium bg-secondary text-foreground/70 border border-border">
                ✓ {h}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-10 sm:py-14 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <p className="text-sm text-muted-foreground leading-relaxed mb-10">
            Reetma ("REETMA", "nous", "notre") s'engage à protéger votre vie privée conformément au
            Règlement Général sur la Protection des Données (RGPD, Règlement UE 2016/679).
            La présente politique de confidentialité explique comment nous collectons, utilisons, divulguons
            et protégeons vos informations lorsque vous utilisez notre plateforme et nos services associés.
          </p>

          <div className="space-y-10">
            {sections.map((section, index) => (
              <div key={index} className="border-b border-border pb-10 last:border-0 last:pb-0">
                <h2 className="text-lg font-semibold text-foreground mb-5">{section.title}</h2>
                <div className="space-y-4">
                  {section.items.map((item, i) => (
                    <div key={i}>
                      <h3 className="text-sm font-semibold text-foreground mb-1">{item.subtitle}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{item.text}</p>
                      {item.details && (
                        <ul className="mt-3 list-disc pl-5 space-y-1.5">
                          {item.details.map((d) => (
                            <li key={d.label} className="text-sm text-muted-foreground leading-relaxed">
                              <span className="font-medium text-foreground">{d.label}&nbsp;:</span> {d.text}
                            </li>
                          ))}
                        </ul>
                      )}
                      {item.optOut && <TrackingOptOut />}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 space-y-6">
            <div className="p-6 rounded-2xl bg-secondary/40 border border-border">
              <h2 className="text-base font-semibold text-foreground mb-2">8. Conservation des données</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Nous conservons vos données personnelles aussi longtemps que votre compte est actif ou que cela est nécessaire pour fournir nos services. À la suppression du compte, nous supprimerons ou anonymiserons vos données dans un délai de 90 jours. Les données de la mesure d'audience interne sont conservées 48 heures au plus pour la présence en ligne et 13 mois au plus pour les étapes du parcours d'inscription et les paiements comptés.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-secondary/40 border border-border">
              <h2 className="text-base font-semibold text-foreground mb-2">9. Transferts internationaux</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Reetma opère avec des centres de données dans l'Union européenne. En cas de transfert de données hors UE, nous utilisons les Clauses Contractuelles Types approuvées par la Commission européenne.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-secondary/40 border border-border">
              <h2 className="text-base font-semibold text-foreground mb-2">10. Modifications de cette politique</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Nous pouvons mettre à jour cette politique de confidentialité à tout moment. Toute modification substantielle vous sera notifiée par la publication de la nouvelle politique sur cette page.
              </p>
            </div>
            {/* Booking calendar (/book-a-call, /prendre-rendez-vous). scroll-mt: the link lands below the header and banner. */}
            <div id="rendez-vous" className="scroll-mt-12 p-6 rounded-2xl bg-secondary/40 border border-border">
              <h2 className="text-base font-semibold text-foreground mb-2">Prise de rendez-vous</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Lorsque vous réservez un appel, nous enregistrons votre nom, votre adresse e-mail, le nom de votre entreprise,
                votre fonction et votre téléphone si vous les indiquez, votre message, le créneau choisi et votre fuseau horaire.
                Ces données servent uniquement à organiser l'appel et à vous écrire à son sujet (confirmation, lien de la
                visioconférence, annulation), sur la base des mesures précontractuelles prises à votre demande (article 6.1.b
                du RGPD). Le nom de l'entreprise et l'adresse e-mail sont vérifiés automatiquement pour réserver ce calendrier
                aux entreprises. La réservation est enregistrée comme une demande du centre d'aide, dans notre base de données
                hébergée par Neon dans l'Union européenne, et conservée comme les autres demandes : aussi longtemps que cela est
                nécessaire pour la traiter et en assurer le suivi (voir « 8. Conservation des données »). Pendant la
                réservation, le formulaire en cours (le créneau choisi et ce que vous avez saisi) est gardé dans le stockage de
                session de l'onglet (booking_draft), pour ne pas le perdre en cas de rechargement ; il est effacé à la fermeture
                de l'onglet ou dès la réservation confirmée. Les e-mails qui concernent l'appel
                (confirmation, réponses, annulation) sont envoyés par Resend Inc. (États-Unis), qui reçoit pour cela votre nom,
                votre adresse e-mail, le créneau et le contenu de ces e-mails, dont votre message, dans le cadre de son accord
                de traitement des données et des clauses contractuelles types.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="py-12 sm:py-16 px-4 sm:px-6 bg-secondary/40">
        <div className="max-w-lg mx-auto text-center">
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-muted-foreground mb-4">Questions ?</p>
          <h2 className="text-2xl font-semibold text-foreground tracking-tight mb-4">Protection des données</h2>
          <div className="space-y-1.5 text-sm text-muted-foreground">
            <p>
              <HelpCenterLink lang="fr" plain className="hover:text-foreground transition-colors">
                Centre d'aide
              </HelpCenterLink>
            </p>
            <p>
              <a href="tel:+33670982683" className="hover:text-foreground transition-colors">
                +33 6 70 98 26 83
              </a>
            </p>
            <p className="text-xs text-muted-foreground/60 mt-3">
              Reetma · Pierre Cazaban, entrepreneur individuel · SIREN 132 067 414
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
