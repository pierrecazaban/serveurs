// Emails about calls booked on /book-a-call and /prendre-rendez-vous, in the booker's language, sent from the
// no-reply address through the shared layout (help-center button and "nobody reads this inbox" footer included).
import { emailLayout, sendEmail, esc } from "./_email.js";
import { PATHS, langOf } from "./_lib.js";
import { bookingIcs, cancelToken, describeCall, googleCalendarUrl, validTimeZone } from "./_booking.js";

const TEXT = {
  en: {
    bookedSubject: (c, n) => `Your call with Reetma: ${c.local.day}, ${c.local.time} (${n})`,
    bookedHeading: "Your call is booked",
    bookedIntro: (name) => `Hello ${name}, your 30-minute video call with Reetma is booked.`,
    date: "Date",
    time: (tz) => `Time (${tz})`,
    paris: "Paris time",
    number: "Booking number",
    company: "Company",
    next: "What happens next: we'll email you the video-call link before the call.",
    calendar: "The invitation is attached to this email (.ics file): open it to add the call to your calendar.",
    google: "Add to Google Calendar",
    yourMessage: "Your message",
    noReply: (n) =>
      `Please do not reply to this email: nobody reads this inbox. For any question, send a request from the help center and mention ${n}.`,
    cancel: "Can't make it? Cancel below, then book a new time if you wish.",
    cancelCta: "Cancel or reschedule",
    cancelledSubject: (n) => `Your call with Reetma is cancelled (${n})`,
    cancelledHeading: "Your call is cancelled",
    when: (c) => `${c.local.date} at ${c.local.time} (${c.timeZone})`,
    byBooker: (name, when) => `Hello ${name}, as requested, your call on ${when} has been cancelled.`,
    byAdmin: (name, when) => `Hello ${name}, we're sorry: we had to cancel your call on ${when}.`,
    removeEvent: "If you added it to your calendar, you can delete the event.",
    rebook: "You can book another time whenever you like.",
    rebookCta: "Book another time",
    replySubject: (c, n) => `About your call with Reetma on ${c.local.day} at ${c.local.time} (${n})`,
    replyHeading: "About your call",
    replyIntro: (name, when, paris) =>
      `Hello ${name}, here is our message about your call on ${when}${paris ? `, which is ${paris}` : ""}:`,
    atParis: (c) => `${c.paris.day === c.local.day ? "" : `${c.paris.day} at `}${c.paris.time} in Paris`,
    cancelledReplySubject: (c, n) => `About your cancelled call on ${c.local.day} at ${c.local.time} (${n})`,
    cancelledReplyHeading: "About your cancelled call",
    cancelledReplyIntro: (name, when) => `Hello ${name}, here is our message about your cancelled call on ${when}:`,
  },
  fr: {
    bookedSubject: (c, n) => `Votre appel avec Reetma : ${c.local.day} à ${c.local.time} (${n})`,
    bookedHeading: "Votre appel est réservé",
    bookedIntro: (name) => `Bonjour ${name}, votre appel vidéo de 30 minutes avec Reetma est réservé.`,
    date: "Date",
    time: (tz) => `Heure (${tz})`,
    paris: "Heure de Paris",
    number: "Numéro de réservation",
    company: "Entreprise",
    next: "Et ensuite : nous vous enverrons le lien de la visioconférence par e-mail avant l'appel.",
    calendar: "L'invitation est jointe à cet e-mail (fichier .ics) : ouvrez-la pour ajouter l'appel à votre agenda.",
    google: "Ajouter à Google Agenda",
    yourMessage: "Votre message",
    noReply: (n) =>
      `Merci de ne pas répondre à cet e-mail : personne ne lit cette boîte. Pour toute question, envoyez une demande depuis le centre d'aide en indiquant ${n}.`,
    cancel: "Un empêchement ? Annulez ci-dessous, puis réservez un nouveau créneau si vous le souhaitez.",
    cancelCta: "Annuler ou déplacer",
    cancelledSubject: (n) => `Votre appel avec Reetma est annulé (${n})`,
    cancelledHeading: "Votre appel est annulé",
    when: (c) => `${c.local.date} à ${c.local.time} (${c.timeZone})`,
    byBooker: (name, when) => `Bonjour ${name}, comme vous l'avez demandé, votre appel du ${when} est annulé.`,
    byAdmin: (name, when) => `Bonjour ${name}, nous sommes désolés : nous avons dû annuler votre appel du ${when}.`,
    removeEvent: "Si vous l'aviez ajouté à votre agenda, vous pouvez supprimer l'événement.",
    rebook: "Vous pouvez réserver un autre créneau quand vous le souhaitez.",
    rebookCta: "Choisir un autre créneau",
    replySubject: (c, n) => `À propos de votre appel avec Reetma du ${c.local.day} à ${c.local.time} (${n})`,
    replyHeading: "À propos de votre appel",
    replyIntro: (name, when, paris) =>
      `Bonjour ${name}, voici notre message au sujet de votre appel du ${when}${paris ? `, soit ${paris}` : ""} :`,
    atParis: (c) => `${c.paris.day === c.local.day ? "" : `le ${c.paris.day} à `}${c.paris.time} à Paris`,
    cancelledReplySubject: (c, n) => `À propos de votre appel annulé du ${c.local.day} à ${c.local.time} (${n})`,
    cancelledReplyHeading: "À propos de votre appel annulé",
    cancelledReplyIntro: (name, when) =>
      `Bonjour ${name}, voici notre message au sujet de votre appel annulé du ${when} :`,
  },
};

// French puts a space before the colon.
const colon = (lang) => (lang === "fr" ? " :" : ":");

const para = (html) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#4B5B58">${html}</p>`;
const quote = (text) =>
  `<div style="margin:0 0 20px;padding:14px 16px;border-left:3px solid #305D55;background:#FBF7F0;font-size:14px;line-height:1.55;color:#1F3B36">${esc(
    text,
  ).replace(/\r?\n/g, "<br>")}</div>`;
const table = (rows) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 20px">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 12px 8px 0;border-bottom:1px solid #ECE5D9;color:#6B7672;vertical-align:top">${esc(k)}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #ECE5D9;color:#1F3B36">${esc(v)}</td></tr>`,
    )
    .join("")}</table>`;

/**
 * Confirmation right after a booking: date and time in the booker's zone and in Paris time, the .ics invitation
 * attached, and the link to cancel (the cancel page asks for a click: opening the link never cancels).
 * `call`: { id, number, name, email, lang, company, message, start (ms), tz }.
 */
export async function sendCallBookedEmail(call, origin) {
  const lang = langOf(call.lang);
  const t = TEXT[lang];
  const c = describeCall(call.start, call.tz, lang);
  const cancelUrl = `${origin}${PATHS[lang].bookCancel}?t=${encodeURIComponent(cancelToken(call))}`;
  const googleUrl = googleCalendarUrl({ number: call.number, start: call.start, lang });
  const rows = [
    [t.date, c.local.date],
    [t.time(c.timeZone), c.local.range],
    ...(c.paris ? [[t.paris, c.paris.date === c.local.date ? c.paris.range : `${c.paris.date}, ${c.paris.range}`]] : []),
    [t.number, call.number],
    [t.company, call.company],
  ];
  const { html, text } = emailLayout({
    lang,
    origin,
    brand: "Reetma",
    heading: t.bookedHeading,
    bodyHtml:
      para(esc(t.bookedIntro(call.name))) +
      table(rows) +
      para(`<strong>${esc(t.next)}</strong>`) +
      para(`${esc(t.calendar)} <a href="${esc(googleUrl)}" style="color:#305D55">${esc(t.google)}</a>`) +
      para(`<strong>${esc(t.yourMessage)}${colon(lang)}</strong>`) +
      quote(call.message) +
      para(esc(t.noReply(call.number))) +
      para(esc(t.cancel)),
    bodyText: [
      t.bookedIntro(call.name),
      "",
      ...rows.map(([k, v]) => `${k}${colon(lang)} ${v}`),
      "",
      t.next,
      t.calendar,
      `${t.google}${colon(lang)} ${googleUrl}`,
      "",
      `${t.yourMessage}${colon(lang)}`,
      call.message,
      "",
      t.noReply(call.number),
      "",
      t.cancel,
    ].join("\n"),
    cta: { label: t.cancelCta, url: cancelUrl },
  });
  return sendEmail({
    to: call.email,
    subject: t.bookedSubject(c, call.number),
    html,
    text,
    idempotencyKey: `reetma-call-booked/${call.number}`,
    tag: "call_booked",
    fromName: "Reetma",
    attachments: [
      {
        filename: `reetma-call-${call.number}.ics`,
        content: Buffer.from(bookingIcs({ number: call.number, start: call.start, lang }), "utf8").toString("base64"),
        contentType: "text/calendar; charset=utf-8; method=PUBLISH",
      },
    ],
  });
}

/**
 * Answer written in the back office on a call ticket (how the video-call link is sent), under the Reetma brand like
 * the other call emails. `ticket`: { number, name, email, lang, call_at, call_tz, call_cancelled_at } of the answered
 * ticket. The answer is written from Paris: the call's Paris time is added when it differs. A cancelled call is named
 * as such (the booker's cancellation reopens the ticket, which is then often the one answered).
 */
export async function sendCallReplyEmail(ticket, body, messageId, origin) {
  const lang = langOf(ticket.lang);
  const t = TEXT[lang];
  const c = describeCall(new Date(ticket.call_at).getTime(), validTimeZone(ticket.call_tz), lang);
  const cancelled = Boolean(ticket.call_cancelled_at);
  const intro = cancelled
    ? t.cancelledReplyIntro(ticket.name, t.when(c))
    : t.replyIntro(ticket.name, t.when(c), c.paris && t.atParis(c));
  const { html, text } = emailLayout({
    lang,
    origin,
    brand: "Reetma",
    heading: cancelled ? t.cancelledReplyHeading : t.replyHeading,
    bodyHtml: para(esc(intro)) + quote(body) + para(esc(t.noReply(ticket.number))),
    bodyText: [intro, "", body, "", t.noReply(ticket.number)].join("\n"),
  });
  return sendEmail({
    to: ticket.email,
    subject: (cancelled ? t.cancelledReplySubject : t.replySubject)(c, ticket.number),
    html,
    text,
    idempotencyKey: `reetma-ticket-reply/${messageId}`,
    tag: "ticket_reply",
    fromName: "Reetma",
  });
}

/** The call was cancelled, by the booker (`by: "booker"`) or from the back office (`by: "admin"`). */
export async function sendCallCancelledEmail(call, by, origin) {
  const lang = langOf(call.lang);
  const t = TEXT[lang];
  const when = t.when(describeCall(call.start, call.tz, lang));
  const intro = by === "admin" ? t.byAdmin(call.name, when) : t.byBooker(call.name, when);
  const { html, text } = emailLayout({
    lang,
    origin,
    brand: "Reetma",
    heading: t.cancelledHeading,
    bodyHtml: para(esc(intro)) + para(esc(t.removeEvent)) + para(esc(t.rebook)),
    bodyText: [intro, "", t.removeEvent, "", t.rebook].join("\n"),
    cta: { label: t.rebookCta, url: `${origin}${PATHS[lang].book}` },
  });
  return sendEmail({
    to: call.email,
    subject: t.cancelledSubject(call.number),
    html,
    text,
    idempotencyKey: `reetma-call-cancelled/${call.number}`,
    tag: "call_cancelled",
    fromName: "Reetma",
  });
}
