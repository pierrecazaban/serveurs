// The certificate as a card, in the style of the certificate shown on the L'École page.
// The `certificate-print` class is what gets printed (see CertificatePage).
export function CertificateCard({
  fullName,
  title,
  code,
  date,
  labels,
  verifyUrl,
}: {
  fullName: string;
  title: string;
  code: string;
  date: string;
  labels: { awardedTo: string; issuedOn: string; number: string };
  verifyUrl: string;
}) {
  return (
    <div
      className="certificate-print relative mx-auto w-full max-w-[760px] overflow-hidden rounded-xl border px-6 py-10 text-center sm:px-12 sm:py-14"
      style={{
        background: "#FBF7F0",
        borderColor: "#E6DCCB",
        boxShadow: "0 14px 40px rgba(31, 59, 54, 0.12)",
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      <span aria-hidden="true" className="absolute left-5 top-4 text-2xl sm:left-7 sm:top-6" style={{ color: "#F28A4B" }}>
        ✦
      </span>
      <p className="font-heading text-lg font-bold tracking-[0.45em] sm:text-2xl" style={{ color: "#1F4A3F" }}>
        REETMA
      </p>
      <div className="mx-auto mt-2 h-[3px] w-14 rounded-full" style={{ background: "#F28A4B" }} />
      <h2 className="mt-6 font-heading text-[26px] font-bold leading-tight sm:text-[40px]" style={{ color: "#1F3B36" }}>
        Certificate of Completion
      </h2>
      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] sm:text-sm" style={{ color: "#305D55" }}>
        {title}
      </p>
      <p className="mt-8 text-[11px] uppercase tracking-[0.22em] sm:mt-10" style={{ color: "#6B7672" }}>
        {labels.awardedTo}
      </p>
      <p className="mt-2 break-words font-heading text-[26px] font-bold sm:text-[38px]" style={{ color: "#1F3B36" }}>
        {fullName}
      </p>
      <div
        className="mx-auto mt-8 grid max-w-md grid-cols-2 gap-4 border-t pt-5 text-left sm:mt-10"
        style={{ borderColor: "#E6DCCB" }}
      >
        <div>
          <p className="text-[11px] uppercase tracking-wide" style={{ color: "#6B7672" }}>
            {labels.issuedOn}
          </p>
          <p className="mt-1 text-sm font-semibold" style={{ color: "#1F3B36" }}>
            {date}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide" style={{ color: "#6B7672" }}>
            {labels.number}
          </p>
          <p className="mt-1 font-mono text-sm font-semibold" style={{ color: "#1F3B36" }}>
            {code}
          </p>
        </div>
      </div>
      <p className="mt-8 break-all text-[11px]" style={{ color: "#9AA49F" }}>
        L'École by Reetma · {verifyUrl.replace(/^https?:\/\//, "")}
      </p>
    </div>
  );
}
