import partnerAws from "@/assets/partner-aws.png";
import partnerAzure from "@/assets/partner-azure.png";
import partnerGcp from "@/assets/partner-gcp.png";
import partnerAnthropic from "@/assets/partner-anthropic.svg";
import partnerMistral from "@/assets/partner-mistral.svg";
import partnerDatabricks from "@/assets/partner-databricks.svg";

const partners = [
  { name: "AWS", logo: partnerAws },
  { name: "Microsoft Azure", logo: partnerAzure },
  { name: "Google Cloud", logo: partnerGcp },
  { name: "Anthropic", logo: partnerAnthropic },
  { name: "Mistral AI", logo: partnerMistral },
  { name: "Databricks", logo: partnerDatabricks },
];

export function Partners() {
  return (
    <section id="technologies" className="py-16 bg-white">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="flex items-center gap-4 mb-10">
          <div className="w-8 h-[3px]" style={{ background: "#F28A4B" }} />
          <span className="text-[11px] font-semibold tracking-[0.3em] uppercase" style={{ color: "#305D55" }}>
            Technologies we build on
          </span>
        </div>

        <div className="flex flex-wrap justify-center gap-x-6 gap-y-10">
          {partners.map((p) => (
            <div key={p.name} className="w-[150px] sm:w-[160px] flex flex-col items-center justify-center gap-3">
              <div className="flex items-center justify-center h-24 px-4">
                <img
                  src={p.logo}
                  alt={p.name}
                  className="max-h-16 max-w-[120px] object-contain"
                  loading="lazy"
                />
              </div>
              <span className="text-[12px] font-medium tracking-wide" style={{ color: "#6B7672" }}>
                {p.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
