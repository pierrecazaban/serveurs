import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Linkedin, Printer } from "lucide-react";
import { Seo } from "@/components/Seo";
import { RequireStudent, useRefreshStudent } from "@/components/account/RequireStudent";
import { CertificateCard } from "@/components/account/CertificateCard";
import { STUDENT_TEXT } from "@/components/account/studentText";
import { BackLink, Eyebrow, Notice, StudentPage } from "@/components/account/StudentUi";
import { PRIMARY_STYLE, SECONDARY_STYLE, primaryButton, secondaryButton } from "@/components/account/studentStyles";
import {
  StudentApiError,
  certificateVerifyUrl,
  fetchCertificate,
  formatDate,
  issueYearMonth,
  type CertificateDetails,
} from "@/lib/student";
import { SCHOOL_PATHS, useSchoolLang, type SchoolLang } from "@/lib/school/lang";

// Only the certificate card is printed (A4 landscape), with its colors.
const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 12mm; }
  body * { visibility: hidden !important; }
  .certificate-print, .certificate-print * { visibility: visible !important; }
  .certificate-print { position: absolute !important; left: 0; top: 0; width: 100% !important; max-width: none !important; box-shadow: none !important; }
}`;

/** LinkedIn "Add license or certification" form, prefilled. */
function linkedinUrl(details: CertificateDetails, lang: SchoolLang) {
  const { year, month } = issueYearMonth(details.certificate.issued_at);
  const org = details.organization.id
    ? `&organizationId=${encodeURIComponent(details.organization.id)}`
    : `&organizationName=${encodeURIComponent(details.organization.name)}`;
  return (
    "https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME" +
    `&name=${encodeURIComponent(details.name)}` +
    org +
    `&issueYear=${year}&issueMonth=${month}` +
    `&certUrl=${encodeURIComponent(certificateVerifyUrl(lang, details.certificate.code))}` +
    `&certId=${encodeURIComponent(details.certificate.code)}`
  );
}

export default function CertificatePage() {
  const lang = useSchoolLang();
  return <RequireStudent>{() => <CertificateView lang={lang} />}</RequireStudent>;
}

function CertificateView({ lang }: { lang: SchoolLang }) {
  const t = STUDENT_TEXT[lang];
  const c = t.certificate;
  const paths = SCHOOL_PATHS[lang];
  const refreshStudent = useRefreshStudent();
  const [copied, setCopied] = useState(false);
  const query = useQuery({ queryKey: ["student-certificate", lang], queryFn: () => fetchCertificate(lang), retry: false });
  const status = query.error instanceof StudentApiError ? query.error.status : 0;

  useEffect(() => {
    if (status === 401) refreshStudent(null);
  }, [status, refreshStudent]);

  const details = query.data;
  const url = details ? certificateVerifyUrl(lang, details.certificate.code) : "";

  return (
    <>
      <Seo
        title={c.seoTitle}
        description={c.seoTitle}
        path={paths.certificate}
        lang={lang}
        alternates={{ en: SCHOOL_PATHS.en.certificate, fr: SCHOOL_PATHS.fr.certificate }}
        noindex
      />
      <style>{PRINT_CSS}</style>
      <StudentPage wide>
        <BackLink to={paths.account}>{t.backToSpace}</BackLink>
        <Eyebrow>{t.brand}</Eyebrow>
        <h1 className="mb-8 font-heading text-2xl font-bold sm:text-3xl" style={{ color: "#1F3B36" }}>
          {c.title}
        </h1>

        {query.isLoading && <div className="h-72 animate-pulse rounded-xl" style={{ background: "#F5EFE5" }} />}

        {status === 404 && (
          <div className="space-y-5">
            <p className="text-base" style={{ color: "#4B5B58" }}>{c.none}</p>
            <Link to={paths.test} className={primaryButton} style={PRIMARY_STYLE}>
              {c.toTest}
            </Link>
          </div>
        )}
        {query.isError && status !== 404 && status !== 401 && <Notice tone="error">{t.genericError}</Notice>}

        {details && (
          <>
            <CertificateCard
              fullName={details.certificate.full_name}
              title={details.title}
              code={details.certificate.code}
              date={formatDate(details.certificate.issued_at, lang)}
              labels={{ awardedTo: c.awardedTo, issuedOn: c.issuedOn, number: c.number }}
              verifyUrl={url}
            />

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <a href={linkedinUrl(details, lang)} target="_blank" rel="noopener noreferrer" className={primaryButton} style={{ background: "#0A66C2" }}>
                <Linkedin className="h-4 w-4" aria-hidden="true" />
                {c.linkedin}
              </a>
              <button type="button" onClick={() => window.print()} className={secondaryButton} style={SECONDARY_STYLE}>
                <Printer className="h-4 w-4" aria-hidden="true" />
                {c.print}
              </button>
            </div>

            <section className="mx-auto mt-12 max-w-2xl rounded-lg border bg-white p-5 sm:p-6" style={{ borderColor: "#ECE5D9" }}>
              <h2 className="mb-4 font-heading text-lg font-bold" style={{ color: "#1F3B36" }}>
                {c.linkedinTitle}
              </h2>
              <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed" style={{ color: "#4B5B58" }}>
                {c.linkedinSteps(details.organization.name).map((step, i) => (
                  <li key={i}>
                    {step}
                    {i === 2 && (
                      <span className="mt-2 flex flex-wrap gap-2">
                        {details.skills.map((skill) => (
                          <span key={skill} className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "#E3EDE7", color: "#305D55" }}>
                            {skill}
                          </span>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </section>

            <section className="mx-auto mt-6 max-w-2xl rounded-lg p-5 sm:p-6" style={{ background: "#FBF6EE", border: "1px solid #ECE5D9" }}>
              <h2 className="mb-1 font-heading text-base font-bold" style={{ color: "#1F3B36" }}>
                {c.verifyTitle}
              </h2>
              <p className="mb-3 text-sm" style={{ color: "#4B5B58" }}>{c.verifyBody}</p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-sm underline" style={{ color: "#305D55" }}>
                  {url}
                </a>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(url);
                    setCopied(true);
                  }}
                  className="shrink-0 px-4 py-2 text-xs font-semibold"
                  style={SECONDARY_STYLE}
                >
                  {copied ? c.copied : c.copy}
                </button>
              </div>
            </section>
          </>
        )}
      </StudentPage>
    </>
  );
}
