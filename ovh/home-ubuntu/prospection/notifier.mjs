// Every few minutes (launchd): sends the video link of each newly booked call in the candidate's LinkedIn conversation.
import { api, browser, log, pause } from './lib.mjs';

const { pending } = await api('/api/calls/pending');
if (!pending.length) process.exit(0);

const b = await browser();
const ctx = b.contexts()[0];
for (const call of pending) {
  const page = await ctx.newPage();
  try {
    await page.goto(call.linkedin, { waitUntil: 'domcontentloaded' });
    await pause(3000, 5000);
    if (page.url().includes('/login') || page.url().includes('/checkpoint')) throw new Error('LinkedIn déconnecté : reconnecte-toi dans le Chrome de prospection');
    // The profile's own "Message" button (only there once the invitation is accepted).
    const button = page.locator('main').getByRole('button', { name: /^(Message|Envoyer un message)/ }).first()
      .or(page.locator('main a[href*="/messaging/compose"]').first());
    if (!(await button.count())) { log('pas de bouton Message (pas encore en relation ?)', call.linkedin); continue; }
    if (process.env.DRY_RUN) { log('[test] bouton Message trouvé, rien envoyé', call.linkedin); continue; }
    await button.first().click();
    await pause(2500, 4000);
    const box = page.locator('.msg-form__contenteditable[contenteditable="true"], div[role="textbox"][contenteditable="true"]').last();
    await box.waitFor({ timeout: 15000 });
    const text = `Super ${call.first_name}, c’est noté pour ${call.when} (heure de Paris) ! Voici le lien de la visio : ${call.meet_url}\nÀ très vite 🙂`;
    await box.click();
    await page.keyboard.insertText(text);
    await pause(800, 1500);
    const send = page.locator('button.msg-form__send-button, button[type="submit"]:has-text("Envoyer"), button:has-text("Send")').last();
    await send.click();
    await pause(2500, 4000);
    await api('/api/calls/notified', { method: 'POST', body: JSON.stringify({ id: call.id }) });
    log('lien envoyé sur LinkedIn', call.reference, call.linkedin);
  } catch (err) {
    log('échec', call.reference, String(err).slice(0, 300));
  } finally {
    await page.close().catch(() => {});
  }
  await pause(20000, 40000); // spaced out like a person
}
process.exit(0);
