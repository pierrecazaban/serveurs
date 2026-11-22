// Emails about help-center tickets, sent from the no-reply address through the shared layout
// (help-center button and "nobody reads this inbox" footer come from emailLayout).
import { emailLayout, sendEmail, esc } from "./_email.js";
import { langOf } from "./_lib.js";

const TEXT = {
  en: {
    receivedSubject: (n) => `We received your request ${n}`,
    receivedHeading: "We received your request",
    receivedBody: (name, n) => `Hello ${name}, your request ${n} is registered. We will answer you by email.`,
    yourMessage: "Your message",
    replySubject: (n) => `Answer to your request ${n}`,
    replyHeading: "We answered your request",
    replyIntro: (name, n) => `Hello ${name}, here is our answer to your request ${n}:`,
    noReply: (n) =>
      `Please do not reply to this email: nobody reads this inbox. To follow up, send a new request from the help center and mention ${n}.`,
    subjectLabel: "Subject",
  },
  fr: {
    receivedSubject: (n) => `Nous avons bien reçu votre demande ${n}`,
    receivedHeading: "Nous avons bien reçu votre demande",
    receivedBody: (name, n) => `Bonjour ${name}, votre demande ${n} est bien enregistrée. Nous vous répondrons par e-mail.`,
    yourMessage: "Votre message",
    replySubject: (n) => `Réponse à votre demande ${n}`,
    replyHeading: "Nous avons répondu à votre demande",
    replyIntro: (name, n) => `Bonjour ${name}, voici notre réponse à votre demande ${n} :`,
    noReply: (n) =>
      `Merci de ne pas répondre à cet e-mail : personne ne lit cette boîte. Pour donner suite, envoyez une nouvelle demande depuis le centre d'aide en indiquant ${n}.`,
    subjectLabel: "Objet",
  },
};

// French puts a space before the colon.
const colon = (lang) => (lang === "fr" ? " :" : ":");

const para = (html) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#4B5B58">${html}</p>`;
// Escaped text with its line breaks kept.
const quote = (text) =>
  `<div style="margin:0 0 20px;padding:14px 16px;border-left:3px solid #305D55;background:#FBF7F0;font-size:14px;line-height:1.55;color:#1F3B36">${esc(
    text,
  ).replace(/\r?\n/g, "<br>")}</div>`;

/** "Request received" email, sent right after the ticket is created. */
export async function sendTicketReceivedEmail(ticket, message, origin) {
  const lang = langOf(ticket.lang);
  const t = TEXT[lang];
  const { html, text } = emailLayout({
    lang,
    origin,
    heading: t.receivedHeading,
    bodyHtml:
      para(esc(t.receivedBody(ticket.name, ticket.number))) +
      para(`<strong>${esc(t.subjectLabel)}${colon(lang)}</strong> ${esc(ticket.subject)}`) +
      para(`<strong>${esc(t.yourMessage)}${colon(lang)}</strong>`) +
      quote(message) +
      para(esc(t.noReply(ticket.number))),
    bodyText: [
      t.receivedBody(ticket.name, ticket.number),
      "",
      `${t.subjectLabel}${colon(lang)} ${ticket.subject}`,
      "",
      `${t.yourMessage}${colon(lang)}`,
      message,
      "",
      t.noReply(ticket.number),
    ].join("\n"),
  });
  return sendEmail({
    to: ticket.email,
    subject: t.receivedSubject(ticket.number),
    html,
    text,
    idempotencyKey: `reetma-ticket-received/${ticket.number}`,
    tag: "ticket_received",
  });
}

/** Answer written in the back office, emailed to the person who opened the ticket. */
export async function sendTicketReplyEmail(ticket, body, messageId, origin) {
  const lang = langOf(ticket.lang);
  const t = TEXT[lang];
  const { html, text } = emailLayout({
    lang,
    origin,
    heading: t.replyHeading,
    bodyHtml:
      para(esc(t.replyIntro(ticket.name, ticket.number))) +
      quote(body) +
      para(esc(t.noReply(ticket.number))),
    bodyText: [t.replyIntro(ticket.name, ticket.number), "", body, "", t.noReply(ticket.number)].join("\n"),
  });
  return sendEmail({
    to: ticket.email,
    subject: t.replySubject(ticket.number),
    html,
    text,
    idempotencyKey: `reetma-ticket-reply/${messageId}`,
    tag: "ticket_reply",
  });
}
