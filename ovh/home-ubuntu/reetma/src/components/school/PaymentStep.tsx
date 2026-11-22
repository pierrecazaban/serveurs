import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { reportPaymentRedirect } from "@/lib/presence";
import { schoolFeatures, schoolText } from "@/config/school";
import { HelpCenterLink } from "@/components/school/HelpCenterLink";
import { REGISTRATION_TEXT } from "@/components/school/registrationText";
import { useSchoolLang } from "@/lib/school/lang";

interface Props {
  registrationId: string;
  clientToken: string;
  checkoutUrl?: string;
  holdExpiresAt: string;
  summary: {
    name: string;
    email: string;
    university: string;
    intake: string;
  };
  onBack: () => void;
  onRetry: () => void;
}

function formatTime(date: Date, lang: "en" | "fr") {
  return date.toLocaleTimeString(lang === "fr" ? "fr-FR" : [], { hour: "numeric", minute: "2-digit" });
}

export function PaymentStep({ holdExpiresAt, checkoutUrl, summary, onBack, onRetry }: Props) {
  const lang = useSchoolLang();
  const t = REGISTRATION_TEXT[lang];
  const text = schoolText(lang);
  const holdDate = useMemo(() => new Date(holdExpiresAt), [holdExpiresAt]);
  const [expired, setExpired] = useState(holdDate.getTime() <= Date.now());

  useEffect(() => {
    const tick = window.setInterval(() => {
      if (holdDate.getTime() <= Date.now()) setExpired(true);
    }, 1000);
    return () => clearInterval(tick);
  }, [holdDate]);

  if (expired) {
    return (
      <div className="space-y-4">
        <p className="text-base font-medium" style={{ color: "#1F3B36" }}>
          {t.payment.expired}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="px-6 py-3 text-sm font-semibold text-white"
          style={{ background: "#305D55" }}
        >
          {t.payment.tryAgain}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg p-4" style={{ background: "#FBF6EE", border: "1px solid #E3EDE7" }}>
        <p className="text-sm font-semibold mb-2" style={{ color: "#1F3B36" }}>
          {t.payment.summary}
        </p>
        <dl className="text-sm space-y-1" style={{ color: "#4B5B58" }}>
          <div className="flex justify-between gap-4">
            <dt>{t.rows.name}</dt>
            <dd>{summary.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>{t.rows.email}</dt>
            <dd className="break-all">{summary.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>{t.rows.university}</dt>
            <dd className="text-right">{summary.university}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>{t.rows.intake}</dt>
            <dd>{summary.intake}</dd>
          </div>
          <div className="flex justify-between gap-4 pt-2 font-semibold" style={{ color: "#1F3B36" }}>
            <dt>{t.registrationFee}</dt>
            <dd>{text.priceDisplay}</dd>
          </div>
        </dl>
      </div>

      <p className="text-sm" style={{ color: "#4B5B58" }}>
        {t.payment.seatHeld(formatTime(holdDate, lang))}
      </p>

      {!schoolFeatures.payments ? (
        <p className="text-sm font-semibold" style={{ color: "#B91C1C" }}>{t.errors.paymentsUnavailable}</p>
      ) : checkoutUrl ? (
        <a
          href={checkoutUrl}
          onClick={() => reportPaymentRedirect()}
          className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white"
          style={{ background: "#305D55" }}
        >
          {t.payment.pay(text.priceDisplay)}
          <ArrowRight className="w-4 h-4" />
        </a>
      ) : (
        <button
          type="button"
          onClick={onRetry}
          className="px-6 py-3 text-sm font-semibold text-white"
          style={{ background: "#305D55" }}
        >
          {t.payment.tryAgain}
        </button>
      )}

      <p className="text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
        {t.payment.mollieNote}
        <HelpCenterLink />.
      </p>

      <p className="text-xs leading-relaxed" style={{ color: "#6B7672" }}>
        {text.independenceNotice}
      </p>

      <button
        type="button"
        onClick={onBack}
        className="text-sm font-medium underline"
        style={{ color: "#305D55" }}
      >
        {t.payment.backToDetails}
      </button>
    </div>
  );
}
