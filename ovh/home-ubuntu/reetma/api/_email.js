// Transactional emails, sent through Resend from a no-reply address.
// Needs two Vercel environment variables; without them nothing is sent:
//   RESEND_API_KEY  (re_...)
//   EMAIL_FROM      e.g. "L'École by Reetma <no-reply@reetma-agency.com>" (domain verified in Resend)
// Every email carries a help-center button and says that nobody reads the sending inbox.
import { PATHS, langOf } from "./_lib.js";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

const FOOTER = {
  en: {
    help: "Help center",
    noReply:
      "This email was sent automatically from an address that does not receive replies: nobody reads this inbox. For any question, use our help center.",
    legal: "Reetma, Pierre Cazaban, entrepreneur individuel (France).",
  },
  fr: {
    help: "Centre d'aide",
    noReply:
      "Cet e-mail est envoyé automatiquement depuis une adresse qui ne reçoit pas de réponses : personne ne lit cette boîte. Pour toute question, passez par notre centre d'aide.",
    legal: "Reetma, Pierre Cazaban, entrepreneur individuel (France).",
  },
};

const button = (url, label, primary = true) =>
  `<a href="${esc(url)}" style="display:inline-block;padding:12px 22px;border-radius:6px;font-size:15px;font-weight:bold;text-decoration:none;${
    primary ? "background:#305D55;color:#ffffff" : "background:#ffffff;color:#305D55;border:1px solid #305D55"
  }">${esc(label)}</a>`;

/**
 * Wraps content in the Reetma email layout.
 * `bodyHtml` / `bodyText` are already escaped / plain; `cta` is an optional main button;
 * `brand` replaces the "L'École by Reetma" line above the heading (e.g. "Reetma" for business emails).
 */
export function emailLayout({ lang, origin, heading, bodyHtml, bodyText, cta, brand }) {
  const l = langOf(lang);
  const f = FOOTER[l];
  const helpUrl = `${origin}${PATHS[l].help}`;
  const html = `<!doctype html><html lang="${l}"><body style="margin:0;background:#FBF7F0;font-family:Arial,Helvetica,sans-serif;color:#1F3B36">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF7F0;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #ECE5D9">
<tr><td style="height:4px;background:#305D55"></td></tr>
<tr><td style="padding:32px">
<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#F28A4B">${brand ? esc(brand) : "L'École by Reetma"}</p>
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#1F3B36">${esc(heading)}</h1>
${bodyHtml}
${cta ? `<p style="margin:24px 0 0">${button(cta.url, cta.label)}</p>` : ""}
</td></tr>
<tr><td style="padding:20px 32px 28px;border-top:1px solid #ECE5D9;background:#FBF7F0">
<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#4B5B58">${esc(f.noReply)}</p>
${button(helpUrl, f.help, false)}
</td></tr></table>
<p style="max-width:560px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#9AA49F">${esc(f.legal)}</p>
</td></tr></table></body></html>`;
  const text = [heading, "", bodyText, cta ? `\n${cta.label}: ${cta.url}` : "", "", "—", f.noReply, `${f.help}: ${helpUrl}`, "", f.legal]
    .filter((x) => x !== null)
    .join("\n");
  return { html, text };
}

const p = (s) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#4B5B58">${s}</p>`;

// Same sender address as EMAIL_FROM, under another display name.
const fromAs = (name) => `${name} <${(/<([^>]+)>/.exec(process.env.EMAIL_FROM)?.[1] ?? process.env.EMAIL_FROM).trim()}>`;

/**
 * Sends one email. Returns false when email is not configured; throws on a Resend error.
 * `attachments`: [{ filename, content (base64), contentType? }]; `fromName` replaces EMAIL_FROM's display name.
 */
export async function sendEmail({ to, subject, html, text, idempotencyKey, tag, attachments, fromName }) {
  if (!emailConfigured()) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      // Resend drops a repeated key for 24 h (e.g. Mollie calling the webhook twice).
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: fromName ? fromAs(fromName) : process.env.EMAIL_FROM,
      to: [to],
      subject,
      html,
      text,
      ...(tag ? { tags: [{ name: "type", value: tag }] } : {}),
      ...(attachments?.length
        ? {
            attachments: attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              ...(a.contentType ? { content_type: a.contentType } : {}),
            })),
          }
        : {}),
    }),
  });
  if (!res.ok) {
    const err = new Error(`Resend error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return true;
}

// ---- Registration confirmation (sent by the Mollie webhook once paid) ----
const REGISTRATION = {
  en: {
    subject: (ref) => `You're in: L'École by Reetma (${ref})`,
    heading: (name) => `You're in, ${name}.`,
    confirmed: "Your registration to L'École is confirmed.",
    rows: ["Reference", "University", "Intake", "Amount paid"],
    next: "Your student space gives you immediate access to the training: 3 modules to follow at your own pace, then the final test. Pass it to get your certificate, ready to add to your LinkedIn profile.",
    cta: "Open my student space",
    amount: (v) => `€${v}`,
  },
  fr: {
    subject: (ref) => `Votre inscription est confirmée : L'École by Reetma (${ref})`,
    heading: (name) => `C'est confirmé, ${name} !`,
    confirmed: "Votre inscription à L'École est confirmée.",
    rows: ["Référence", "Université", "Promotion", "Montant payé"],
    next: "Votre espace étudiant vous donne accès tout de suite à la formation : 3 modules à suivre à votre rythme, puis le test final. Réussissez-le pour obtenir votre certificat, à ajouter à votre profil LinkedIn.",
    cta: "Accéder à mon espace étudiant",
    amount: (v) => `${v.replace(".", ",")} €`,
  },
};
const INTAKE_FR = { "Fall 2026": "Automne 2026" };

export async function sendRegistrationEmail(payment, origin) {
  const m = payment.metadata || {};
  const lang = langOf(m.lang);
  const t = REGISTRATION[lang];
  const intake = lang === "fr" ? (INTAKE_FR[m.intake] ?? m.intake) : m.intake;
  const values = [m.ref, m.uni, intake, t.amount(payment.amount.value)];
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 20px">${t.rows
    .map(
      (k, i) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #ECE5D9;color:#6B7672">${esc(k)}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #ECE5D9;color:#1F3B36">${esc(values[i])}</td></tr>`,
    )
    .join("")}</table>`;
  const { html, text } = emailLayout({
    lang,
    origin,
    heading: t.heading(m.fn),
    bodyHtml: p(esc(t.confirmed)) + table + p(esc(t.next)),
    bodyText: [t.confirmed, "", ...t.rows.map((k, i) => `${k}: ${values[i]}`), "", t.next].join("\n"),
    cta: { label: t.cta, url: `${origin}${PATHS[lang].confirmation}?pid=${encodeURIComponent(payment.id)}` },
  });
  return sendEmail({
    to: m.em,
    subject: t.subject(m.ref),
    html,
    text,
    idempotencyKey: `reetma-school-confirmation/${payment.id}`,
    tag: "school_confirmation",
  });
}

// ---- Password reset ----
const RESET = {
  en: {
    subject: "Reset your L'École password",
    heading: "Reset your password",
    body: "Someone (hopefully you) asked to reset the password of your L'École student space. The link below works once and expires in 1 hour.",
    ignore: "If you didn't ask for this, ignore this email: your password stays the same.",
    cta: "Choose a new password",
  },
  fr: {
    subject: "Réinitialisez votre mot de passe L'École",
    heading: "Réinitialisez votre mot de passe",
    body: "Une demande de réinitialisation du mot de passe de votre espace étudiant L'École a été faite (par vous, nous l'espérons). Le lien ci-dessous ne fonctionne qu'une fois et expire dans 1 heure.",
    ignore: "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé.",
    cta: "Choisir un nouveau mot de passe",
  },
};

export async function sendPasswordResetEmail(student, token, origin) {
  const lang = langOf(student.lang);
  const t = RESET[lang];
  const { html, text } = emailLayout({
    lang,
    origin,
    heading: t.heading,
    bodyHtml: p(esc(t.body)) + p(esc(t.ignore)),
    bodyText: [t.body, "", t.ignore].join("\n"),
    cta: { label: t.cta, url: `${origin}${PATHS[lang].reset}?token=${encodeURIComponent(token)}` },
  });
  return sendEmail({ to: student.email, subject: t.subject, html, text, tag: "password_reset" });
}
