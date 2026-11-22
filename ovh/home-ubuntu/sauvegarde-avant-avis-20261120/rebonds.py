"""Mails « non distribués » (Undeliverable, Non remis…) reçus pendant un envoi.

Deux cas, à ne pas confondre :
- la BOÎTE de l'étudiant est bloquée pour l'envoi (expéditeur refusé, soupçon de
  spam, limite d'envoi atteinte) : tout mail suivant échouerait aussi, et insister
  aggrave le blocage. L'envoi se met en pause ;
- UN élève n'a pas reçu (adresse introuvable, boîte pleine, refusée chez lui) :
  on le note « non distribué » et l'envoi continue.
Un avis qu'on ne sait pas classer met en pause aussi, par prudence.

Le serveur lit la boîte de réception dans un onglet à part (jamais celui où
l'extension écrit les mails), et seulement les avis de non-distribution. Rien de
leur contenu n'est gardé ni écrit dans les journaux.
"""

import hashlib
import re

from . import config

# Un avis de non-distribution (objet, expéditeur ou début du texte), en plusieurs langues.
MOTIF_AVIS = (r"undeliverable|non remis|non distribu|non délivr|unzustellbar|no se puede entregar|non recapitabile|"
              r"delivery status notification|mail delivery (failed|subsystem)|returned mail|delivery has failed|"
              r"n.a pas pu être remis|couldn.t be delivered|wasn.t delivered|message not delivered|"
              r"remise a échoué|échec de (la )?remise")
RE_AVIS = re.compile(MOTIF_AVIS, re.I)

# La boîte de l'EXPÉDITEUR est en cause (Exchange Online : 5.1.8, 5.7.705, 5.7.708,
# 5.7.501/503, 5.1.90, 5.2.2 « submission quota »…).
RE_BLOCAGE = re.compile(
    r"weren.t recognized as a valid sender|not recognized as a valid sender|"
    r"n.avez pas été reconnu comme (un )?expéditeur valide|"
    r"suspected of sending spam|soupçonnée? d.envoyer|"
    r"(your )?account (has been |is )?(blocked|suspended|restricted)|"
    r"votre compte (a été |est )?(bloqué|suspendu|restreint)|"
    r"blocked from sending|bloqué(e)? pour l.envoi|empêché d.envoyer|"
    r"reached (your|the) (daily )?(sending |recipient |message )?limit|"
    r"atteint (votre|la) limite|limite (quotidienne|d.envoi)|daily limit for message recipients|"
    r"exceeded .{0,40}(sending|recipient|submission) (limit|quota)|submission quota|"
    r"bad outbound sender|spam abuse|outbound spam|"
    r"\b5\.1\.8\b|\b5\.7\.70[358]\b|\b5\.7\.50[13]\b|\b5\.1\.90\b|\b5\.2\.2 submission",
    re.I)

# UN destinataire en cause (vu dans les vrais avis d'Exchange Online : « Votre message
# envoyé à … n'a pas pu être remis » 550 5.1.10 ; 5.1.1 introuvable ; boîte pleine).
RE_DESTINATAIRE = re.compile(
    r"\b5\.1\.10\b|\b5\.1\.1\b|\b5\.1\.0\b|RecipientNotFound|RecipNotFound|"
    r"wasn.t found at|couldn.t be found|address (is )?(not found|introuvable)|adresse (est )?introuvable|est introuvable|"
    r"n.existe pas|does not exist|doesn.t exist|no such user|user unknown|"
    r"mailbox (is )?full|over quota|boîte (aux lettres )?(de réception )?(est )?pleine|\b[45]\.2\.2 mailbox|\b4\.2\.2\b",
    re.I)

RE_ADRESSE = re.compile(r"[\w.%+-]+@[\w-]+(?:\.[\w-]+)+")

# La boîte de réception d'Outlook web : la liste des messages et le message ouvert.
LIGNES = '[role="listbox"] [role="option"], [role="option"][data-convid]'
CORPS = ('[aria-label="Corps du message"], [aria-label="Message body"], [aria-label="Nachrichtentext"], '
         '[role="document"]')
# Gmail : les lignes de la boîte (tr.zA) et le message ouvert (div.a3s).
LIGNES_GMAIL = 'tr.zA'
CORPS_GMAIL = 'div.a3s, div.ii.gt'


def classer(texte, adresses):
    """(« blocage » | « eleve » | « inconnu », [adresses d'élèves concernées])."""
    if RE_BLOCAGE.search(texte or ""):
        return "blocage", []
    voulues = {a.lower() for a in adresses}
    eleves = sorted({a.lower() for a in RE_ADRESSE.findall(texte or "") if a.lower() in voulues})
    if eleves:
        return "eleve", eleves
    if RE_DESTINATAIRE.search(texte or ""):
        return "eleve", []  # un destinataire en cause, qu'on ne sait pas nommer : on continue
    return "inconnu", []


def _cle(ligne):
    return ligne.get("id") or hashlib.sha256((ligne.get("texte") or "").encode()).hexdigest()[:24]


class Boite:
    """Un onglet sur la boîte de réception, ouvert à côté de l'envoi."""

    def __init__(self, contexte, messagerie="outlook"):
        self.contexte = contexte
        self.page = None
        self.vus = set()
        self.gmail = messagerie == "gmail"
        self.url = config.GMAIL_URL if self.gmail else config.OUTLOOK_BOITE
        self.lignes = LIGNES_GMAIL if self.gmail else LIGNES
        self.corps = CORPS_GMAIL if self.gmail else CORPS

    async def ouvrir(self):
        self.page = await self.contexte.new_page()
        await self.page.goto(self.url, wait_until="domcontentloaded")
        try:
            await self.page.locator(self.lignes).first.wait_for(state="attached", timeout=8000)
        except Exception:
            pass  # boîte vide ou lente : l'envoi ne l'attend pas, on relira plus tard
        # Les avis déjà là avant l'envoi ne le concernent pas.
        for ligne in await self._avis():
            self.vus.add(_cle(ligne))

    async def _avis(self):
        try:
            return await self.page.evaluate("""([sel, motif]) => {
                const re = new RegExp(motif, 'i');
                return Array.from(document.querySelectorAll(sel)).slice(0, 60).map((e, i) => ({
                    i, id: e.getAttribute('data-convid') || e.getAttribute('data-item-id') || e.id || '',
                    texte: ((e.getAttribute('aria-label') || '') + ' ' + (e.innerText || '')).slice(0, 2000) }))
                  .filter(l => re.test(l.texte)); }""", [self.lignes, MOTIF_AVIS])
        except Exception:
            return []

    async def nouveaux(self, adresses):
        """Les avis arrivés depuis le dernier passage, classés : [(type, élèves)]."""
        if self.page is None:
            await self.ouvrir()
            return []
        resultats = []
        for ligne in await self._avis():
            cle = _cle(ligne)
            if cle in self.vus:
                continue
            self.vus.add(cle)
            texte = ligne["texte"]
            # Le message entier (codes d'erreur, adresse refusée) : ouvert dans CET onglet.
            try:
                await self.page.locator(self.lignes).nth(ligne["i"]).click(timeout=5000)
                corps = self.page.locator(self.corps).first
                await corps.wait_for(state="visible", timeout=8000)
                texte += "\n" + (await corps.inner_text(timeout=5000))[:6000]
            except Exception:
                pass
            if self.gmail:  # Gmail ouvre le message à la place de la liste : retour à la boîte
                try:
                    await self.page.goto(self.url, wait_until="domcontentloaded")
                    await self.page.locator(self.lignes).first.wait_for(state="attached", timeout=8000)
                except Exception:
                    pass
            resultats.append(classer(texte, adresses))
        return resultats

    async def fermer(self):
        try:
            if self.page is not None:
                await self.page.close()
        except Exception:
            pass
        self.page = None
