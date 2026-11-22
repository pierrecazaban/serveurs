// "Your certificate is ready" email, sent when a student passes the final test (the test is the certification).
import { emailLayout, sendEmail, esc } from "./_email.js";
import { PATHS, langOf } from "./_lib.js";
import { CERTIFICATE } from "./_course.js";

const p = (s) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#4B5B58">${s}</p>`;

const TEXT = {
  en: {
    subject: "Your L'École certificate is ready",
    heading: (name) => `Congratulations, ${name}!`,
    passed: "You passed the final test. Your certificate is ready in your student space:",
    number: (code) => `Certificate number: ${code}`,
    linkedin: `To add it to your LinkedIn profile, open your certificate and click “Add to LinkedIn”: the form opens already filled in, with ${CERTIFICATE.organizationName} as the issuing organization. Before saving, add the suggested skills by hand.`,
    cta: "View my certificate",
  },
  fr: {
    subject: "Votre certificat L'École est disponible",
    heading: (name) => `Félicitations, ${name} !`,
    passed: "Vous avez réussi le test final. Votre certificat vous attend dans votre espace étudiant :",
    number: (code) => `Numéro de certificat : ${code}`,
    linkedin: `Pour l'ajouter à votre profil LinkedIn, ouvrez votre certificat et cliquez sur « Ajouter à LinkedIn » : le formulaire s'ouvre déjà rempli, avec ${CERTIFICATE.organizationName} comme organisme émetteur. Avant d'enregistrer, ajoutez à la main les compétences suggérées.`,
    cta: "Voir mon certificat",
  },
};

export async function sendCertificateEmail(student, certificate, origin) {
  const lang = langOf(student.lang);
  const t = TEXT[lang];
  const { html, text } = emailLayout({
    lang,
    origin,
    heading: t.heading(student.first_name),
    bodyHtml:
      p(esc(t.passed)) +
      p(`<strong>${esc(CERTIFICATE.name)}</strong><br>${esc(t.number(certificate.code))}`) +
      p(esc(t.linkedin)),
    bodyText: [t.passed, "", CERTIFICATE.name, t.number(certificate.code), "", t.linkedin].join("\n"),
    cta: { label: t.cta, url: `${origin}${PATHS[lang].certificate}` },
  });
  return sendEmail({
    to: student.email,
    subject: t.subject,
    html,
    text,
    idempotencyKey: `reetma-certificate/${certificate.code}`,
    tag: "certificate_issued",
  });
}
