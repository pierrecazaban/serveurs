// Shown instead of the registration and payment while schoolFeatures.payments is off.
import { HelpCenterLink } from "@/components/school/HelpCenterLink";
import type { SchoolLang } from "@/lib/school/lang";

const TEXT = {
  en: {
    title: "Payments temporarily unavailable",
    body: "Online registration will reopen very soon. Please come back in a few days.",
    help: "A question? Visit the help center.",
  },
  fr: {
    title: "Paiements temporairement indisponibles",
    body: "Les inscriptions en ligne rouvrent très bientôt. Revenez d'ici quelques jours.",
    help: "Une question ? Rendez-vous dans le centre d'aide.",
  },
};

export function PaymentsPaused({ lang, compact = false }: { lang: SchoolLang; compact?: boolean }) {
  const t = TEXT[lang];
  return (
    <div role="status" className={`rounded-md border ${compact ? "mt-6 p-4" : "p-6"}`} style={{ borderColor: "#E3EDE7", background: "#FBF6EE" }}>
      <p className="font-semibold" style={{ color: "#1F3B36" }}>{t.title}</p>
      <p className="mt-1 text-sm leading-relaxed" style={{ color: "#4B5B58" }}>{t.body}</p>
      {!compact && (
        <p className="mt-3 text-sm">
          <HelpCenterLink lang={lang} className="underline" style={{ color: "#305D55" }}>{t.help}</HelpCenterLink>
        </p>
      )}
    </div>
  );
}
