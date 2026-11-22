import { Helmet } from "react-helmet-async";

const SITE_URL = "https://reetma-agency.com";

interface SeoProps {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
  image?: string;
  /** Page language (default English). */
  lang?: "en" | "fr";
  /** Paths of the same page in each language, for hreflang links. */
  alternates?: { en: string; fr: string };
}

export function Seo({ title, description, path, noindex, image, lang = "en", alternates }: SeoProps) {
  const url = `${SITE_URL}${path}`;

  return (
    <Helmet>
      <html lang={lang} />
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      {alternates ? <link rel="alternate" hrefLang="en" href={`${SITE_URL}${alternates.en}`} /> : null}
      {alternates ? <link rel="alternate" hrefLang="fr" href={`${SITE_URL}${alternates.fr}`} /> : null}
      {alternates ? <link rel="alternate" hrefLang="x-default" href={`${SITE_URL}${alternates.en}`} /> : null}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content="website" />
      <meta property="og:locale" content={lang === "fr" ? "fr_FR" : "en_US"} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      {image ? <meta property="og:image" content={image} /> : null}
      {image ? <meta name="twitter:image" content={image} /> : null}
      {image ? <meta name="twitter:card" content="summary_large_image" /> : null}
      {noindex ? <meta name="robots" content="noindex, nofollow" /> : null}
    </Helmet>
  );
}
