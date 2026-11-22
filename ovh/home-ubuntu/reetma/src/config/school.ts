// Single source of truth for L'École settings.
// Values written as [PLACEHOLDER] are not filled in yet and are shown
// as obviously unfinished in the preview.

export const schoolConfig = {
  // Feature flags
  SHOW_VALUE_ANCHOR: false,
  VALUE_TEXT: "[VALUE_TEXT]",
  SMS_ENABLED: false,
  TURNSTILE_ENABLED: false,

  // Legal
  legalEntity: "Reetma, Pierre Cazaban, entrepreneur individuel (SIREN 132 067 414)",
  jurisdiction: "France",
  emailProvider: "Resend",
  retentionPaid: "[RETENTION_PAID]",

  // Terms versioning
  termsVersion: "2026-10",
  lastUpdated: "October 26, 2026",

  // Price
  // Payments are created per student by /api/school/register (Mollie API).
  intake: { id: "fall-2026", name: "Fall 2026" },
  price: {
    amountCents: 3000,
    display: "€30",
    currency: "EUR",
  },

  // Seat counter display. When set, this overrides the live computed value on the page.
  seatsDisplay: {
    total: 287,
    left: 39,
  } as { total: number; left: number } | null,

  // Program facts
  feeCovers: "full access to the training (3 modules), the final test and the certificate.",
  refundPolicy:
    "L'École is a digital product (online modules, final test and digital certificate), so purchases are final and non-refundable once access starts. By ticking the dedicated box before payment, you ask for immediate access and acknowledge that you lose your right of withdrawal. You are refunded only if you were charged by mistake, if Reetma cannot give you access, or if the content is not delivered as described.",
  prerequisites: "No. You just need basic computer skills and a willingness to learn. You need a laptop and a reliable internet connection. No prior AI or coding experience is required.",
  ipPolicy: "The agent you build is yours. You keep full ownership of your final project and you are free to use it, show it and build on it after the program. Reetma may ask your permission before showcasing your project, and will never use it without it.",
  // The training: 3 online modules, available right after payment, followed at your own pace.
  modules: [
    "Foundations: what AI can and cannot do at work, how to write prompts that produce useful outputs, and how to choose the right tool for the task.",
    "Automation: connect AI to your documents, data and daily workflows to build a simple agent that performs a real job you define.",
    "Refinement: improve, test and troubleshoot your agent, then get ready for the final test.",
  ],

  // Market evidence shown to reinforce the value of certification.
  marketEvidence: [
    {
      headline: "2 in 3 leaders won't hire without AI skills",
      source: "Microsoft & LinkedIn, 2024 Work Trend Index",
      url: "https://news.microsoft.com/source/2024/05/08/microsoft-and-linkedin-release-the-2024-work-trend-index/",
    },
    {
      headline: "AI and big data is the top technology skill companies are prioritizing",
      source: "World Economic Forum, Future of Jobs Report 2025",
      url: "https://www.weforum.org/publications/the-future-of-jobs-report-2025/",
    },
    {
      headline: "AI literacy is the fastest-growing skill category on LinkedIn",
      source: "LinkedIn, 2024 Workplace Learning Report",
      url: "https://learning.linkedin.com/resources/workplace-learning-report",
    },
  ] as const,

  // Leave empty to hide the instructors section. Never invent people.
  instructors: [] as { name: string; role: string; photo?: string }[],
} as const;

export const INDEPENDENCE_NOTICE =
  "Select your university to check your eligibility for the student offer. This program is run independently by Reetma. It is not organized by any university, it does not award academic credit.";

export const SCHOOL_URL = "https://reetma-agency.com/school";

/** Features still being rolled out. While off, the confirmation page does not offer the student space. */
export const schoolFeatures = {
  studentSpace: true,
  // false: registration pages show "payments temporarily unavailable" (server side: SCHOOL.paymentsOpen in api/_lib.js).
  payments: true,
};

/** Every piece of program text shown to students, in the language of the page (/school or /ecole). */
export interface SchoolText {
  priceDisplay: string;
  feeCovers: string;
  refundPolicy: string;
  prerequisites: string;
  ipPolicy: string;
  modules: readonly string[];
  marketEvidence: readonly { headline: string; source: string; url: string }[];
  independenceNotice: string;
}

const SCHOOL_TEXT_EN: SchoolText = {
  priceDisplay: schoolConfig.price.display,
  feeCovers: schoolConfig.feeCovers,
  refundPolicy: schoolConfig.refundPolicy,
  prerequisites: schoolConfig.prerequisites,
  ipPolicy: schoolConfig.ipPolicy,
  modules: schoolConfig.modules,
  marketEvidence: schoolConfig.marketEvidence,
  independenceNotice: INDEPENDENCE_NOTICE,
};

const SCHOOL_TEXT_FR: SchoolText = {
  priceDisplay: "30 €",
  feeCovers: "l'accès complet à la formation (3 modules), au test final et au certificat.",
  refundPolicy:
    "L'École est un produit numérique (modules en ligne, test final et certificat numérique) : l'achat est définitif et non remboursable dès que l'accès commence. En cochant la case prévue avant le paiement, vous demandez un accès immédiat et reconnaissez perdre votre droit de rétractation. Vous n'êtes remboursé que si vous avez été débité par erreur, si Reetma ne peut pas vous donner accès, ou si le contenu n'est pas fourni conformément à sa description.",
  prerequisites:
    "Non. Il suffit de savoir utiliser un ordinateur et d'avoir envie d'apprendre. Il vous faut un ordinateur portable et une connexion internet fiable. Aucune expérience en IA ni en programmation n'est nécessaire.",
  ipPolicy:
    "L'agent que vous construisez vous appartient. Vous gardez l'entière propriété de votre projet final et êtes libre de l'utiliser, de le montrer et de le faire évoluer après le programme. Reetma peut vous demander l'autorisation de présenter votre projet, et ne l'utilisera jamais sans votre accord.",
  modules: [
    "Fondamentaux : ce que l'IA peut et ne peut pas faire au travail, comment écrire des prompts qui donnent des résultats utiles, et comment choisir le bon outil pour chaque tâche.",
    "Automatisation : connecter l'IA à vos documents, vos données et vos tâches quotidiennes pour construire un agent simple qui accomplit un vrai travail que vous définissez.",
    "Perfectionnement : améliorer, tester et dépanner votre agent, puis vous préparer au test final.",
  ],
  marketEvidence: [
    {
      headline: "2 dirigeants sur 3 refusent d'embaucher sans compétences en IA",
      source: "Microsoft & LinkedIn, Work Trend Index 2024",
      url: schoolConfig.marketEvidence[0].url,
    },
    {
      headline: "L'IA et le big data sont la compétence technologique que les entreprises privilégient le plus",
      source: "Forum économique mondial, Future of Jobs Report 2025",
      url: schoolConfig.marketEvidence[1].url,
    },
    {
      headline: "La maîtrise de l'IA est la catégorie de compétences qui progresse le plus vite sur LinkedIn",
      source: "LinkedIn, Workplace Learning Report 2024",
      url: schoolConfig.marketEvidence[2].url,
    },
  ],
  independenceNotice:
    "Sélectionnez votre université pour vérifier votre éligibilité à l'offre étudiante. Ce programme est organisé de manière indépendante par Reetma. Il n'est organisé par aucune université et ne donne pas droit à des crédits universitaires.",
};

export function schoolText(lang: "en" | "fr"): SchoolText {
  return lang === "fr" ? SCHOOL_TEXT_FR : SCHOOL_TEXT_EN;
}

export function isPlaceholder(value?: string | null): boolean {
  return !!value && /^\[[A-Z0-9_]+\]$/.test(value.trim());
}
