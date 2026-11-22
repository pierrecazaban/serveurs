import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, SearchX } from "lucide-react";
import { Seo } from "@/components/Seo";
import { CertificateCard } from "@/components/account/CertificateCard";
import { STUDENT_TEXT } from "@/components/account/studentText";
import { Eyebrow, Notice, StudentPage } from "@/components/account/StudentUi";
import { certificateVerifyUrl, formatDate, verifyCertificate } from "@/lib/student";
import { SCHOOL_PATHS, useSchoolLang } from "@/lib/school/lang";

// Public page linked from LinkedIn ("certUrl"): confirms that a certificate number is genuine.
export default function CertificateVerify() {
  const lang = useSchoolLang();
  const t = STUDENT_TEXT[lang];
  const v = t.verify;
  const code = (useParams().code ?? "").trim().toUpperCase();
  const query = useQuery({ queryKey: ["certificate-verify", code], queryFn: () => verifyCertificate(code), retry: false });
  const cert = query.data;

  return (
    <>
      <Seo
        title={v.seoTitle}
        description={v.seoDescription}
        path={`${SCHOOL_PATHS[lang].verify}/${code}`}
        lang={lang}
        alternates={{ en: `${SCHOOL_PATHS.en.verify}/${code}`, fr: `${SCHOOL_PATHS.fr.verify}/${code}` }}
        noindex
      />
      <StudentPage wide>
        <Eyebrow>{t.brand}</Eyebrow>

        {query.isLoading && (
          <p className="text-base" style={{ color: "#4B5B58" }}>
            {v.checking}
          </p>
        )}
        {query.isError && <Notice tone="error">{t.genericError}</Notice>}

        {query.isSuccess && !cert && (
          <div className="max-w-2xl">
            <h1 className="mb-3 flex items-center gap-3 font-heading text-2xl font-bold sm:text-3xl" style={{ color: "#1F3B36" }}>
              <SearchX className="h-7 w-7 shrink-0" style={{ color: "#B4561F" }} aria-hidden="true" />
              {v.notFoundTitle}
            </h1>
            <p className="text-base leading-relaxed" style={{ color: "#4B5B58" }}>
              {v.notFoundBody(code || "—")}
            </p>
            <Link to={SCHOOL_PATHS[lang].home} className="mt-6 inline-block text-sm font-medium underline" style={{ color: "#305D55" }}>
              {v.discover}
            </Link>
          </div>
        )}

        {cert && (
          <>
            <h1 className="mb-2 flex items-center gap-3 font-heading text-2xl font-bold sm:text-3xl" style={{ color: "#1F3B36" }}>
              <BadgeCheck className="h-8 w-8 shrink-0" style={{ color: "#305D55" }} aria-hidden="true" />
              {v.validTitle}
            </h1>
            <p className="mb-8 text-base" style={{ color: "#4B5B58" }}>
              {v.validBody}
            </p>

            <dl className="mb-10 max-w-2xl divide-y rounded-lg border bg-white text-sm" style={{ borderColor: "#ECE5D9" }}>
              {[
                [v.holder, cert.full_name],
                [v.certificate, cert.name],
                [v.issuedOn, formatDate(cert.issued_at, lang)],
                [v.number, cert.code],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:justify-between sm:gap-6" style={{ borderColor: "#ECE5D9" }}>
                  <dt style={{ color: "#6B7672" }}>{label}</dt>
                  <dd className="font-medium sm:text-right" style={{ color: "#1F3B36" }}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <CertificateCard
              fullName={cert.full_name}
              title={cert.name.replace(/ – Certificate of Completion$/, "")}
              code={cert.code}
              date={formatDate(cert.issued_at, lang)}
              labels={{ awardedTo: t.certificate.awardedTo, issuedOn: t.certificate.issuedOn, number: t.certificate.number }}
              verifyUrl={certificateVerifyUrl(lang, cert.code)}
            />
          </>
        )}
      </StudentPage>
    </>
  );
}
