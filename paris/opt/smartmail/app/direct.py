"""Connexion en direct : la vraie page de connexion Microsoft, affichée dans l'app.

Le serveur ouvre Outlook web dans son navigateur et montre la page à la personne,
en direct (images envoyées au fil des changements). Elle touche, tape et valide
comme sur outlook.com : mot de passe, Authenticator, SMS, page de son école…
Rien à deviner pour le serveur, donc ça marche pour tout le monde.

Dès que la messagerie est ouverte, le serveur garde la session Outlook (chiffrée,
rattachée au compte) et l'app reçoit sa session d'appareil.

Le compte est celui qu'OUTLOOK confirme (données de démarrage de la messagerie),
pas une adresse tapée quelque part : on ne peut pas ouvrir le compte d'un autre
en tapant son adresse puis en se connectant avec le sien.

Une connexion survit à une courte coupure (passage dans Authenticator sur iPhone,
réseau qui saute) : l'app se rebranche sur la même page.
"""

import asyncio
import base64
import json
import re
import secrets
import shutil
import time
from urllib.parse import parse_qs

from . import base, config, navigateur

ACTIVE_MAX = 15 * 60       # une connexion dure au plus 15 min
SANS_CLIENT_MAX = 5 * 60   # page gardée 5 min sans l'app (Authenticator, réseau)
TOUCHES = {"Backspace", "Enter", "Tab", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape"}
_ecrans = {}
_essais = {}

UA_IPHONE = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
             "Version/18.0 Mobile/15E148 Safari/604.1")
UA_ORDI = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
ADRESSE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class Ecran:
    def __init__(self, largeur, hauteur, appareil, ip):
        self.id = "dx_" + secrets.token_urlsafe(24)
        self.largeur, self.hauteur = largeur, hauteur
        self.appareil, self.ip = appareil, ip
        self.cree = time.monotonic()
        self.vu = time.monotonic()
        self.contexte = self.page = self.cdp = None
        self.clients = set()
        self.image = None          # dernière image (base64), renvoyée à qui se rebranche
        self.etat = "ouverture"    # ouverture | ouvert | reussie | echec
        self.message = ""
        self.resultat = None       # {code, nom, email, role}, remis une seule fois
        self.identite_outlook = ""  # propriétaire de la session, selon Outlook
        self.identite_mdp = ""      # adresse envoyée avec le mot de passe accepté par Microsoft
        self.tache = None
        self.clavier = None
        self.sauts_cle = 0
        self.messagerie = "outlook"  # outlook | gmail

    def vue(self):
        v = {"id": self.id, "etat": self.etat}
        if self.message:
            v["message"] = self.message
        return v


def _essai_permis(ip):
    maintenant = time.monotonic()
    l = [t for t in _essais.get(ip, []) if maintenant - t < 900]
    if len(l) >= config.ESSAIS_PAR_IP:
        _essais[ip] = l
        return False
    l.append(maintenant)
    _essais[ip] = l
    return True


def trouver(eid):
    return _ecrans.get(eid)


# ------------------------------------------------------------------ envoi aux clients
async def _diffuser(e, message):
    texte = json.dumps(message)
    for ws in list(e.clients):
        try:
            await ws.send_text(texte)
        except Exception:
            e.clients.discard(ws)


async def _changer(e, etat, message=""):
    e.etat, e.message = etat, message
    await _diffuser(e, {"t": "etat", **e.vue()})


# ------------------------------------------------------------------ qui est connecté ?
# Seulement des clés qui désignent le PROPRIÉTAIRE de la session dans la configuration
# d'Outlook (jamais « EmailAddress » : un expéditeur de message en a une aussi).
CLES_PROPRIETAIRE = ("UserEmailAddress", "LogonEmailAddress")
RE_PROPRIETAIRE = re.compile(r'"(?:UserEmailAddress|LogonEmailAddress)"\s*:\s*"([^"@\s]+@[^"\s]+)"')


def _adresse_dans(donnees, profondeur=0):
    if profondeur > 8:
        return ""
    if isinstance(donnees, dict):
        for cle in CLES_PROPRIETAIRE:
            v = donnees.get(cle)
            if isinstance(v, str) and ADRESSE.match(v.strip()):
                return v.strip().lower()
        for v in donnees.values():
            a = _adresse_dans(v, profondeur + 1)
            if a:
                return a
    elif isinstance(donnees, list):
        for v in donnees[:50]:
            a = _adresse_dans(v, profondeur + 1)
            if a:
                return a
    return ""


def _brancher_identite(e, page):
    """Deux sources sûres : la configuration de démarrage d'Outlook (le propriétaire de
    la session) ; à défaut, l'adresse envoyée AVEC le mot de passe que Microsoft vient
    d'accepter. Jamais une adresse simplement tapée dans le premier champ."""
    async def reponse(r):
        try:
            u = r.url
            if "startupdata" in u.lower() or "UserConfiguration" in u:
                a = _adresse_dans(await r.json())
                if a:
                    e.identite_outlook = a
        except Exception:
            pass

    def requete(req):
        try:
            if req.method != "POST":
                return
            champs = parse_qs(req.post_data or "")
            if champs.get("passwd") and champs.get("login"):
                a = champs["login"][0].strip().lower()
                if ADRESSE.match(a):
                    e.identite_mdp = a
        except Exception:
            pass

    page.on("response", lambda r: asyncio.ensure_future(reponse(r)))
    page.on("request", requete)


# Gmail écrit le compte connecté dans le titre de l'onglet (« Boîte de réception (3) -
# lea@ecole.fr - Messagerie… ») et sur le bouton du compte Google. Jamais une adresse
# prise dans le contenu des messages.
RE_TITRE_GMAIL = re.compile(r"\s[-–]\s([^\s@]+@[^\s@]+\.[^\s@]+)\s[-–]\s")
RE_BOUTON_GMAIL = re.compile(r"\(([^()\s@]+@[^()\s@]+\.[^()\s@]+)\)")
BOUTON_COMPTE_GOOGLE = 'a[aria-label^="Compte Google"], a[aria-label^="Google Account"], a[aria-label^="Google-Konto"]'


async def _identite_gmail(e):
    try:
        m = RE_TITRE_GMAIL.search(" " + (await e.page.title()) + " ")
        if m and ADRESSE.match(m.group(1)):
            return m.group(1).strip().lower()
        b = e.page.locator(BOUTON_COMPTE_GOOGLE).first
        if await b.count():
            m = RE_BOUTON_GMAIL.search(await b.get_attribute("aria-label") or "")
            if m and ADRESSE.match(m.group(1)):
                return m.group(1).strip().lower()
    except Exception:
        pass
    return ""


async def _identite_dans_la_page(e):
    """Outlook écrit aussi sa configuration dans la page : on y cherche le propriétaire."""
    try:
        m = RE_PROPRIETAIRE.search(await e.page.content())
        if m and ADRESSE.match(m.group(1)):
            return m.group(1).strip().lower()
    except Exception:
        pass
    return ""


# ------------------------------------------------------------------ ouvrir
async def ouvrir(largeur, hauteur, dpr, appareil, ip, messagerie="outlook"):
    if not _essai_permis(ip):
        return None
    _nettoyer()
    _ARRET.clear()
    e = Ecran(largeur, hauteur, appareil, ip)
    e.messagerie = "gmail" if messagerie == "gmail" else "outlook"
    _ecrans[e.id] = e
    e.tache = asyncio.get_running_loop().create_task(_vivre(e, dpr))
    return e


async def _vivre(e, dpr):
    mobile = e.largeur < 700
    e.boucle = asyncio.get_running_loop()  # pour les tests (lecture de la page depuis un autre fil)
    try:
        nav = await navigateur.navigateur()
        if e.messagerie == "gmail":
            # Google : un profil de navigateur neuf, qui deviendra LE profil de cet ambassadeur
            # (ses tâches s'y rouvriront : Google voit toujours le même navigateur).
            e.profil = navigateur.profils() / f"connexion-{e.id}"
            shutil.rmtree(e.profil, ignore_errors=True)
            e.contexte = await navigateur.lancer_profil_gmail(
                navigateur._pw, e.profil, viewport={"width": e.largeur, "height": e.hauteur}, device_scale_factor=dpr, has_touch=mobile)
        else:
            e.contexte = await nav.new_context(
                viewport={"width": e.largeur, "height": e.hauteur}, device_scale_factor=dpr, is_mobile=mobile, has_touch=mobile,
                user_agent=UA_IPHONE if mobile else UA_ORDI, locale="fr-FR", timezone_id="Europe/Paris")
        await e.contexte.add_init_script(navigateur.SANS_CLE_ACCES)
        if navigateur.installer_routes:
            await navigateur.installer_routes(e.contexte)
        e.page = e.contexte.pages[0] if (e.messagerie == "gmail" and e.contexte.pages) else await e.contexte.new_page()
        _brancher_identite(e, e.page)
        e.cdp = await e.contexte.new_cdp_session(e.page)

        async def image(p):
            try:
                await e.cdp.send("Page.screencastFrameAck", {"sessionId": p["sessionId"]})
            except Exception:
                pass
            e.image = p["data"]
            await _diffuser(e, {"t": "image", "d": p["data"], "w": e.largeur, "h": e.hauteur})

        e.cdp.on("Page.screencastFrame", lambda p: asyncio.ensure_future(image(p)))
        await e.page.goto(navigateur.url_messagerie(e.messagerie), wait_until="domcontentloaded")
        await e.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 70,
                                                  "maxWidth": int(e.largeur * dpr), "maxHeight": int(e.hauteur * dpr)})
        await _changer(e, "ouvert")
        await _veiller(e)
    except asyncio.CancelledError:
        raise
    except navigateur._Echec as x:
        await _changer(e, "echec", x.detail or navigateur.MESSAGES.get(x.cle, navigateur.MESSAGES["inconnu"]))
    except Exception as x:
        print(f"[direct] {type(x).__name__}: {x}", flush=True)
        await _changer(e, "echec", "La page de connexion s'est fermée. Réessayez.")
    finally:
        await _fermer_navigateur(e)
        await _ranger_profil(e)


async def _ranger_profil(e):
    """Google : la connexion a réussi → son profil devient celui de l'ambassadeur, puis on vérifie
    20 s plus tard qu'il rouvre bien Gmail (l'ambassadeur est encore là s'il faut recommencer)."""
    dossier = getattr(e, "profil", None)
    if not dossier:
        return
    uid = getattr(e, "uid", None)
    if e.etat == "reussie" and uid:
        if _ARRET.is_set():  # serveur en train de s'arrêter : le profil est gardé, la vérification se fera plus tard
            cible = navigateur.dossier_profil(uid)
            shutil.rmtree(cible, ignore_errors=True)
            shutil.move(str(dossier), str(cible))
            return
        async with navigateur.verrou_profil(uid):
            cible = navigateur.dossier_profil(uid)
            shutil.rmtree(cible, ignore_errors=True)
            shutil.move(str(dossier), str(cible))

        async def verifier_bientot():
            await asyncio.sleep(20)
            if _ARRET.is_set():
                return
            try:
                if not await navigateur.verifier(uid):
                    print(f"[direct] compte {uid} : session Gmail refusée juste après la connexion", flush=True)
            except Exception as x:
                print(f"[direct] vérification compte {uid} : {x!r}", flush=True)
        _VERIFICATIONS.add(asyncio.get_running_loop().create_task(verifier_bientot()))
        for t in [t for t in _VERIFICATIONS if t.done()]:
            _VERIFICATIONS.discard(t)
    else:
        shutil.rmtree(dossier, ignore_errors=True)


_VERIFICATIONS = set()
_ARRET = asyncio.Event()


# Comptes « clé d'accès d'abord » : le navigateur du serveur n'en a pas, Microsoft le
# dit (« Clé d'accès non inscrite… ce navigateur ne prend pas en charge les clés
# d'accès »). On touche « Annuler » à la place de l'étudiant : il arrive directement
# sur le choix de la méthode (mot de passe, Authenticator, SMS…).
RE_SANS_CLE = re.compile(r"(cl[ée]s? d.acc[eè]s non inscrite|ne prend pas en charge les cl[ée]s d.acc[eè]s|"
                         r"passkey (is )?not registered|doesn.t support passkeys|does not support passkeys)", re.I)
BOUTON_ANNULER = ('a:has-text("Annuler"), button:has-text("Annuler"), [role=button]:has-text("Annuler"), '
                  'a:has-text("Cancel"), button:has-text("Cancel"), [role=button]:has-text("Cancel")')


async def _passer_cle_d_acces(e):
    if e.sauts_cle >= 3:
        return
    try:
        texte = await e.page.locator("body").inner_text(timeout=1500)
    except Exception:
        return
    if not RE_SANS_CLE.search(texte):
        return
    annuler = await navigateur._visible(e.page, BOUTON_ANNULER)
    if annuler:
        e.sauts_cle += 1
        await annuler.click()
        await asyncio.sleep(1.5)


# Compte Microsoft sans boîte mail (ESSEC, 14/11 : la connexion passe par Microsoft, mais les mails sont
# chez Google) : Outlook affiche « Something went wrong… OwaUserHasNoMailbox ». On le dit clairement.
SANS_BOITE = ("Ton école ne range pas tes mails chez Microsoft (Outlook) : ta boîte est chez Google. "
              "Ferme cette fenêtre et choisis « Gmail », puis connecte-toi avec la même adresse de l'école.")


async def _sans_boite_microsoft(e):
    try:
        texte = await e.page.locator("body").inner_text(timeout=1500)
    except Exception:
        return False
    return "OwaUserHasNoMailbox" in texte or "UserHasNoMailbox" in texte


async def _veiller(e):
    """Attend que la messagerie soit ouverte pour de vrai, puis garde la session."""
    while True:
        await _passer_cle_d_acces(e)
        # Le champ actif change aussi sans geste (Microsoft passe seul de l'adresse au mot de passe, puis au
        # code) : l'app doit suivre, sinon sa barre reste sur « adresse » (17/11).
        if e.clients:
            await _clavier(e)
        if time.monotonic() - e.cree > ACTIVE_MAX:
            raise navigateur._Echec("delai")
        if not e.clients and time.monotonic() - e.vu > SANS_CLIENT_MAX:
            raise navigateur._Echec("delai")
        if await navigateur._dans_la_messagerie(e.page, e.messagerie):
            break
        await asyncio.sleep(0.7)
    await _changer(e, "ouvert", "Ouverture de votre messagerie…")
    gmail = e.messagerie == "gmail"
    if gmail:
        e.identite_outlook = e.identite_mdp = ""  # Gmail : seulement ce que Gmail affiche du compte
    fin = time.monotonic() + 20
    while not e.identite_outlook and time.monotonic() < fin:
        if not gmail and await _sans_boite_microsoft(e):
            raise navigateur._Echec("inconnu", SANS_BOITE)
        e.identite_outlook = await (_identite_gmail(e) if gmail else _identite_dans_la_page(e))
        if not e.identite_outlook:
            await asyncio.sleep(0.7)
    adresse = e.identite_outlook or e.identite_mdp
    source = ("Gmail" if gmail else "Outlook") if e.identite_outlook else "mot de passe accepté" if e.identite_mdp else "aucune"
    print(f"[direct] messagerie ouverte — identité : {source}", flush=True)
    if not adresse:
        if e.page is not None:
            await navigateur._diagnostic(type("C", (), {"adresse": "inconnue@inconnu"})(), e.page, "identité introuvable")
        raise navigateur._Echec("inconnu", "Votre messagerie est ouverte, mais Smart Mail n'a pas pu confirmer votre adresse. Réessayez.")
    etat = await e.contexte.storage_state()
    e.resultat = navigateur.terminer(adresse, e.appareil, etat, e.messagerie)
    e.uid = (base.utilisateur_par_email(e.resultat["email"]) or {}).get("id")
    await _changer(e, "reussie")


async def _fermer_navigateur(e):
    try:
        if e.cdp:
            await asyncio.wait_for(e.cdp.send("Page.stopScreencast"), timeout=3)
    except BaseException:
        pass
    try:
        if e.contexte:
            await asyncio.wait_for(e.contexte.close(), timeout=10)
    except BaseException:
        pass
    e.contexte = e.page = e.cdp = None


def remettre(e):
    """Le résultat d'une connexion réussie, une seule fois."""
    r, e.resultat = e.resultat, None
    _ecrans.pop(e.id, None)
    return r


def fermer(eid):
    e = _ecrans.pop(eid, None)
    if e and e.tache and not e.tache.done():
        e.tache.cancel()
    return e is not None


def _nettoyer():
    maintenant = time.monotonic()
    for eid, e in list(_ecrans.items()):
        if maintenant - e.cree > ACTIVE_MAX + 300:
            fermer(eid)
    for ip in [ip for ip, l in _essais.items() if not l or maintenant - l[-1] > 900]:
        _essais.pop(ip, None)


async def fermer_tout():
    _ARRET.set()
    for eid in list(_ecrans):
        fermer(eid)
    for t in list(_VERIFICATIONS):  # vérifications de session pas encore faites : le serveur s'arrête
        t.cancel()
    _VERIFICATIONS.clear()


# ------------------------------------------------------------------ gestes de la personne
async def _clavier(e):
    """Champ actif dans la page : l'app pose un vrai champ exactement par-dessus (position, taille, type),
    pour taper dedans normalement (17/11 : fini la barre de saisie en bas)."""
    try:
        info = await e.page.evaluate("""() => { const a = document.activeElement;
            if (!a || !(a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return null;
            const r = a.getBoundingClientRect(), st = getComputedStyle(a);
            // Coordonnées à l'écran (page dézoomée sur téléphone : visualViewport).
            const v = window.visualViewport, z = (v && v.scale) || 1, ox = (v && v.offsetLeft) || 0, oy = (v && v.offsetTop) || 0;
            if (!a.dataset.smId) a.dataset.smId = Math.random().toString(36).slice(2);
            a.style.caretColor = 'transparent'; // le curseur de la page dépassait du champ posé par-dessus
            const type = (a.getAttribute('type') || 'text').toLowerCase();
            return { type, auto: (a.getAttribute('autocomplete') || '').toLowerCase(), id: a.dataset.smId,
                     x: Math.round((r.left - ox) * z), y: Math.round((r.top - oy) * z), l: Math.round(r.width * z), h: Math.round(r.height * z),
                     fs: (parseFloat(st.fontSize) || 15) * z, pg: (parseFloat(st.paddingLeft) || 0) * z,
                     valeur: type === 'password' ? '' : String(a.value || '').slice(0, 200) }; }""")
    except Exception:
        info = None
    # La valeur suit ce qu'on tape : elle ne suffit pas à rediffuser (seuls le champ et sa place comptent).
    cle = None if info is None else {k: v for k, v in info.items() if k != "valeur"}
    if cle != e.clavier:
        e.clavier = cle
        await _diffuser(e, {"t": "clavier", "champ": info})


async def geste(e, m):
    if not e.page or e.etat not in ("ouvert",):
        return
    e.vu = time.monotonic()
    t = m.get("t")
    try:
        if t == "clic":
            x = max(0, min(float(m.get("x", 0)), e.largeur))
            y = max(0, min(float(m.get("y", 0)), e.hauteur))
            await e.page.mouse.click(x, y)
            await asyncio.sleep(0.15)
            await _clavier(e)
        elif t == "texte":
            s = str(m.get("s", ""))[:500]
            if s:
                await e.page.keyboard.insert_text(s)
        elif t == "remplir":
            # Le champ posé sur la page : son contenu remplace celui du champ de la page (adresse pré-remplie,
            # retour en arrière, deuxième essai), jamais ajouté derrière ; Entrée seulement si demandé (17/11).
            s = str(m.get("s", ""))[:500]
            await e.page.keyboard.press("ControlOrMeta+A")
            await e.page.keyboard.press("Delete")  # vide = champ effacé
            if s:
                await e.page.keyboard.insert_text(s)
            if m.get("entree"):
                await asyncio.sleep(0.05)
                await e.page.keyboard.press("Enter")
            await asyncio.sleep(0.15)
            await _clavier(e)
        elif t == "touche":
            k = str(m.get("k", ""))
            if k in TOUCHES:
                await e.page.keyboard.press(k)
                await asyncio.sleep(0.15)
                await _clavier(e)
        elif t == "defile":
            dy = max(-3000, min(float(m.get("dy", 0)), 3000))
            await e.page.mouse.wheel(0, dy)
    except Exception:
        pass
