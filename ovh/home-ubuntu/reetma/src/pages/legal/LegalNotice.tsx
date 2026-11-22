import { Seo } from "@/components/Seo";
import { HelpCenterLink } from "@/components/school/HelpCenterLink";
import { Building2, MapPin, Phone, CreditCard, Server, Shield, Scale } from "lucide-react";

const companyInfo = [
  {
    icon: Building2,
    title: "Entreprise",
    items: [
      { label: "Nom commercial", value: "Reetma" },
      { label: "Forme juridique", value: "Entrepreneur individuel (micro-entreprise)" },
      { label: "Exploitant", value: "Pierre Cazaban" },
      { label: "SIREN", value: "132 067 414" },
    ],
  },
  {
    icon: MapPin,
    title: "Siège social",
    items: [
      { label: "Adresse", value: "74 rue du Mas de Caze, 34090 Montpellier, France" },
    ],
  },
  {
    icon: Phone,
    title: "Contact",
    items: [
      { label: "Centre d'aide", value: "reetma-agency.com/aide", helpCenter: true },
      { label: "Téléphone", value: "+33 6 70 98 26 83", href: "tel:+33670982683" },
    ],
  },
];

const additionalSections = [
  {
    icon: Server,
    title: "Directeur de la publication",
    body: "Le directeur de la publication du site reetma-agency.com est Pierre Cazaban, exploitant de Reetma. Toute demande relative au contenu publié peut lui être adressée depuis le centre d'aide du site (reetma-agency.com/aide).",
  },
  {
    icon: Server,
    title: "Hébergement",
    body: "Le site reetma-agency.com est hébergé par OVH SAS, 2 rue Kellermann, 59100 Roubaix, France (ovhcloud.com). Les paiements sont traités par Stripe Payments Europe, Ltd., 1 Grand Canal Street Lower, Grand Canal Dock, Dublin D02 H210, Irlande. Toute demande technique peut être adressée depuis le centre d'aide du site (reetma-agency.com/aide).",
  },
  {
    icon: Shield,
    title: "Propriété intellectuelle",
    body: "L'ensemble des contenus présents sur ce site, incluant textes, images, logos, marques, vidéos, codes sources et bases de données, sont protégés par le droit français et international de la propriété intellectuelle. Toute reproduction, représentation, modification, publication ou adaptation, totale ou partielle, par quelque procédé que ce soit, est strictement interdite sans autorisation écrite préalable de Reetma. Toute utilisation non autorisée constitue une contrefaçon sanctionnée par les articles L.335.2 et suivants du Code de la propriété intellectuelle.",
  },
  {
    icon: Shield,
    title: "Données personnelles et cookies",
    body: "Les données personnelles collectées via ce site sont traitées conformément au Règlement (UE) 2016/679 (RGPD) et à la loi Informatique et Libertés. Vous disposez d'un droit d'accès, de rectification, d'effacement, de portabilité, de limitation et d'opposition que vous pouvez exercer à tout moment en ouvrant une demande dans le centre d'aide du site (reetma-agency.com/aide). Pour le détail des traitements et de la politique de cookies, merci de consulter la Politique de confidentialité accessible depuis le pied de page du site.",
  },
  {
    icon: Scale,
    title: "Droit applicable et juridiction compétente",
    body: "Les présentes mentions légales et l'utilisation du site sont régies par le droit français. En cas de litige, et à défaut de résolution amiable, les tribunaux compétents du ressort de la Cour d'appel de Paris seront seuls compétents.",
  },
];

export default function LegalNotice() {
  return (
    <div className="pt-20">
      <Seo
        title="Mentions légales | Reetma"
        description="Informations légales de Reetma : identité de la société, siège social, directeur de la publication, hébergement et propriété intellectuelle."
        path="/legal/mentions"
        lang="fr"
      />
      <section className="pt-16 pb-10 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-muted-foreground mb-5">Legal</p>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-foreground tracking-tight leading-[1.08]">
            Mentions légales
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Informations légales relatives à Reetma, conformément à la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique.
          </p>
          <p className="mt-3 text-xs text-muted-foreground/60">Dernière mise à jour : Octobre 2026</p>
        </div>
      </section>

      <section className="py-10 sm:py-14 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {companyInfo.map((section) => (
            <div
              key={section.title}
              className="p-6 rounded-2xl border border-border bg-card transition-all duration-300 hover:shadow-lg hover:shadow-foreground/[0.03] hover:border-foreground/10"
            >
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
                  <section.icon className="w-5 h-5 text-foreground/60" />
                </div>
                <h2 className="text-lg font-semibold text-foreground">{section.title}</h2>
              </div>
              <div className="space-y-3">
                {section.items.map((item) => (
                  <div key={item.label} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide min-w-[160px]">
                      {item.label}
                    </span>
                    {item.helpCenter ? (
                      <HelpCenterLink lang="fr" plain className="text-sm text-foreground hover:text-primary transition-colors">
                        {item.value}
                      </HelpCenterLink>
                    ) : item.href ? (
                      <a href={item.href} className="text-sm text-foreground hover:text-primary transition-colors">
                        {item.value}
                      </a>
                    ) : (
                      <span className="text-sm text-foreground">{item.value}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="py-10 sm:py-14 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {additionalSections.map((section) => (
            <div key={section.title} className="p-6 rounded-2xl bg-secondary/40 border border-border">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-lg bg-background flex items-center justify-center">
                  <section.icon className="w-4 h-4 text-foreground/60" />
                </div>
                <h2 className="text-base font-semibold text-foreground">{section.title}</h2>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{section.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
