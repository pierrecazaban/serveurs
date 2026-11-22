"""Connexion à Outlook web depuis le serveur, comme le ferait la personne.

Dans l'application, on tape son adresse Outlook et son mot de passe, rien d'autre.
Le serveur ouvre Outlook web dans un vrai navigateur (Chromium, Playwright),
remplit la page de connexion de Microsoft, et si Microsoft demande une validation
(nombre à toucher dans Authenticator, code reçu par SMS), l'application l'affiche
à la personne et transmet sa réponse.

Une fois dans la messagerie, le serveur garde la session du navigateur (ses
cookies) : chiffrée, en base, rattachée au compte. C'est elle qui « vit » sur le
VPS ; elle est rouverte quand le serveur doit travailler pour la personne, et
Microsoft la renouvelle à chaque usage. Le mot de passe, lui, n'est gardé qu'en
mémoire le temps de le saisir, puis effacé : il n'est jamais écrit nulle part.
"""

import asyncio
import re
import json
import secrets
import time
from datetime import timedelta
from pathlib import Path

from . import base, coffre, config

# Repères de la page de connexion Microsoft (anciens identifiants stables et
# nouvelle présentation : on essaie les deux).
CHAMP_ADRESSE = 'input[name="loginfmt"], input[type="email"]'
# La page de l'adresse cache déjà un champ mot de passe hors de l'écran (pour le
# remplissage automatique des navigateurs) : surtout ne pas le prendre pour le vrai.
CHAMP_MDP = ('input[name="passwd"]:not(.moveOffScreen):not([aria-hidden="true"]):not([tabindex="-1"]), '
             'input[type="password"]:not(.moveOffScreen):not([aria-hidden="true"]):not([tabindex="-1"])')
# Page de connexion propre à l'établissement (Microsoft y renvoie après l'adresse) :
# ADFS, Shibboleth, Keycloak, CAS… On y remplit l'identifiant s'il est vide.
CHAMP_IDENTIFIANT = ('#userNameInput, input[name="UserName"], input[name="j_username"], input[name="username"], '
                     '#username, input[autocomplete="username"]')
BOUTON_SUIVANT = ('#idSIButton9, [data-testid="primaryButton"], #submitButton, button[name="_eventId_proceed"], #kc-login, '
                  'button[type="submit"], input[type="submit"]')
CASE_RESTER = 'input[name="DontShowAgain"], #KmsiCheckboxField, [data-testid="checkbox"] input'
NOMBRE = '#idRichContext_DisplaySign, [data-testid="displaySign"]'
CHAMP_CODE = 'input[name="otc"], #idTxtBx_SAOTCC_OTC, input[autocomplete="one-time-code"]'
BOUTON_CODE = '#idSubmit_SAOTCC_Continue, [data-testid="primaryButton"], button[type="submit"], input[type="submit"]'
CHOIX_METHODE = '#idDiv_SAOTCS_Proofs [role="button"], #idDiv_SAOTCS_Proofs .table[data-value]'
ERREURS = ('#usernameError, #passwordError, #idTD_Error, #errorText, [data-testid="error"], #idSpan_SAOTCC_Error_OTC, '
           '.form-error, .output--failure, #input-error, .alert-error, .alert-danger, #msg.errors')
CONFIGURER_SECURITE = '#idSubmit_ProofUp_Redirect, #idDiv_ProofUp_Title'
# Connexion par clé d'accès (visage, empreinte, code PIN) : impossible sur un
# serveur. On passe par « Options de connexion » → le mot de passe.
TEXTES_CLE = ("Visage, empreinte digitale, code PIN ou clé de sécurité", "Face, fingerprint, PIN or security key",
              "clé d'accès", "passkey", "Windows Hello")
LIEN_OPTIONS = ('#moreOptions, a#idA_PWD_SwitchToPassword, #idA_PWD_SwitchToCredPicker, [data-testid="moreOptions"], '
                'a:has-text("Options de connexion"), a:has-text("Sign-in options"), a:has-text("Autres moyens"), a:has-text("Other ways")')
OPTION_MDP = ('#idA_PWD_SwitchToPassword, [data-testid="password"], [role=button]:has-text("mot de passe"), '
              '[role=button]:has-text("password"), div.tile:has-text("mot de passe"), div.tile:has-text("password"), '
              'button:has-text("mot de passe"), button:has-text("password"), a:has-text("Utiliser mon mot de passe"), '
              'a:has-text("Use your password")')
# Le navigateur du serveur se déclare sans clé d'accès : Microsoft propose alors le mot de passe.
SANS_CLE_ACCES = """
try { delete window.PublicKeyCredential; } catch (e) {}
try { Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true }); } catch (e) {}
try {
  if (navigator.credentials) {
    const refus = () => Promise.reject(new DOMException('Non disponible', 'NotAllowedError'));
    navigator.credentials.get = refus; navigator.credentials.create = refus;
  }
} catch (e) {}
"""
TEXTES_RESTER = ("Rester connecté", "Stay signed in", "Rester connectée")
TEXTES_VALIDATION = ("Approuver la demande", "Approve sign in request", "Vérifier votre identité", "Verify your identity")

MESSAGES = {
    "adresse": "Microsoft ne reconnaît pas cette adresse.",
    "mdp": "Adresse ou mot de passe incorrect.",
    "code": "Ce code n'est pas le bon. Réessayez.",
    "securite": "Microsoft demande de terminer la configuration de sécurité de ce compte. Faites-le une fois sur "
                "outlook.office.com, puis reconnectez-vous ici.",
    "delai": "La connexion a pris trop de temps. Recommencez.",
    "refus": "La connexion a été refusée sur votre téléphone.",
    "inconnu": "Microsoft affiche une page inattendue. Réessayez dans un instant.",
}


class Connexion:
    """Une connexion en cours, le temps de l'aller-retour avec Microsoft."""

    def __init__(self, adresse, mdp, appareil, ip):
        self.id = "cx_" + secrets.token_urlsafe(24)
        self.adresse = adresse
        self.mdp = mdp  # effacé dès qu'il a été saisi
        self.appareil = appareil
        self.ip = ip
        self.etape = "en_cours"  # en_cours | validation | code | reussie | echec
        self.nombre = ""
        self.message = ""
        self.resultat = None  # {code, nom, email, role} une fois réussie
        self.code_saisi = asyncio.Queue()
        self.debut = time.monotonic()
        self.tache = None

    def vue(self):
        v = {"id": self.id, "etape": self.etape}
        if self.nombre:
            v["nombre"] = self.nombre
        if self.message:
            v["message"] = self.message
        return v


# Pour les tests : fonction async(contexte) qui sert de fausses pages.
installer_routes = None

_connexions = {}
_essais = {}  # clé (adresse ou IP) -> [instants]
_pw = None
_navigateur = None
_demarrage = None  # tâche qui lance Playwright et Chromium
_places = None


def _boucle_prete():
    global _places
    if _places is None:
        _places = asyncio.Semaphore(max(1, config.CONNEXIONS_SIMULTANEES))


async def _lancer(pw):
    if pw is None:
        from playwright.async_api import async_playwright
        pw = await async_playwright().start()
    nav = await pw.chromium.launch(headless=not config.NAVIGATEUR_VISIBLE,
                                   args=["--disable-blink-features=AutomationControlled"])
    return pw, nav


async def navigateur():
    """Un seul Chromium pour tout le serveur ; un contexte isolé par personne."""
    global _pw, _navigateur, _demarrage
    _boucle_prete()
    if _navigateur is not None and _navigateur.is_connected():
        return _navigateur
    if _demarrage is None or _demarrage.done():
        _demarrage = asyncio.get_running_loop().create_task(_lancer(_pw))
    # Le lancement n'est jamais interrompu à mi-chemin : une connexion annulée
    # laisserait sinon le pilote Playwright orphelin, et le serveur ne pourrait plus
    # s'arrêter. On l'attend à l'abri ; fermer() le récupère dans tous les cas.
    _pw, _navigateur = await asyncio.shield(_demarrage)
    return _navigateur


async def fermer():
    """À l'arrêt du serveur (et entre deux séries de tests)."""
    global _pw, _navigateur, _demarrage, _places
    taches = [c.tache for c in _connexions.values() if c.tache and not c.tache.done()]
    for t in taches:
        t.cancel()
    _connexions.clear()
    if taches:
        # On laisse les connexions en cours refermer leur contexte avant de couper le navigateur.
        await asyncio.wait(taches, timeout=10)
    if _demarrage is not None:
        if not _demarrage.done():
            await asyncio.wait([_demarrage], timeout=30)
        if _demarrage.done() and not _demarrage.cancelled() and _demarrage.exception() is None:
            _pw, _navigateur = _demarrage.result()
    for arret in ((lambda: _navigateur.close()) if _navigateur is not None else None,
                  (lambda: _pw.stop()) if _pw is not None else None):
        if arret is None:
            continue
        try:
            await asyncio.wait_for(arret(), timeout=10)
        except Exception:
            pass
    _pw = _navigateur = _demarrage = _places = None


def ua_google(nav):
    """Pour Google : le navigateur tel qu'il est (Chromium sur Linux, sa vraie version),
    le même à la connexion et à chaque réouverture de la session."""
    majeure = (nav.version or "131").split(".")[0]
    return f"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{majeure}.0.0.0 Safari/537.36"


# ------------------------------------------------------------ Google : un profil fixe par ambassadeur
# Google ferme une session dont les cookies passent d'un navigateur à un autre (vol de session
# possible). Pour un compte Gmail, la connexion et toutes ses tâches utilisent donc le MÊME profil
# de navigateur, gardé sur le disque, et jamais deux navigateurs à la fois sur ce profil.
_verrous_profil = {}


def profils():
    return config.BASE.parent / "profils"


def dossier_profil(uid):
    return profils() / str(uid)


def verrou_profil(uid):
    if uid not in _verrous_profil:
        _verrous_profil[uid] = asyncio.Lock()
    return _verrous_profil[uid]


def profil_gmail(uid):
    """Vrai si ce compte Gmail a son profil fixe (connecté depuis la mise en place)."""
    o = base.outlook_infos(uid) or {}
    return (o.get("messagerie") or "outlook") == "gmail" and dossier_profil(uid).is_dir()


def _liberer_verrou_perime(dossier):
    """Chromium laisse « SingletonLock » (-> « hôte-pid ») dans le profil. Après un redémarrage du
    conteneur, l'hôte n'est plus le même : le profil passe pour « utilisé par un autre ordinateur »
    et ne s'ouvre plus (ESCP, 13/11). Un verrou d'un autre hôte, ou d'un processus mort, est retiré."""
    import os, socket
    verrou = Path(dossier) / "SingletonLock"
    try:
        cible = os.readlink(verrou)
    except OSError:
        return
    hote, _, pid = cible.rpartition("-")
    vivant = hote == socket.gethostname() and pid.isdigit() and Path(f"/proc/{pid}").exists()
    if not vivant:
        for nom in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
            try:
                os.unlink(Path(dossier) / nom)
            except OSError:
                pass
        print(f"[gmail] verrou périmé retiré du profil ({hote})", flush=True)


async def lancer_profil_gmail(pw, dossier, extension=False, **options):
    """Le navigateur Google d'un ambassadeur : toujours les mêmes réglages, le même profil."""
    nav = await navigateur()
    args = ["--disable-blink-features=AutomationControlled"]
    if extension:
        ext = str(config.EXTENSION_DIR)
        args = [f"--disable-extensions-except={ext}", f"--load-extension={ext}"] + args
    reglages = {"locale": "fr-FR", "timezone_id": "Europe/Paris", "user_agent": ua_google(nav),
                "viewport": {"width": 1366, "height": 900}}
    reglages.update(options)
    Path(dossier).mkdir(parents=True, exist_ok=True)
    _liberer_verrou_perime(dossier)
    return await pw.chromium.launch_persistent_context(str(dossier), channel="chromium", headless=not config.NAVIGATEUR_VISIBLE,
                                                       args=args, **reglages)


async def _verifier_profil_gmail(uid):
    """True : Gmail s'ouvre (cookies renouvelés gardés). False : Google demande de se reconnecter.
    None : on ne sait pas (Gmail lent…) — la session n'est alors jamais oubliée pour rien."""
    contexte = await lancer_profil_gmail(_pw, dossier_profil(uid))
    try:
        if installer_routes:
            await installer_routes(contexte)
        page = contexte.pages[0] if contexte.pages else await contexte.new_page()
        await page.goto(url_messagerie("gmail"), wait_until="domcontentloaded")
        fin = time.monotonic() + 60
        while time.monotonic() < fin:
            if await _dans_la_messagerie(page, "gmail"):
                base.outlook_rafraichir(uid, coffre.fermer(json.dumps(await contexte.storage_state())))
                return True
            if "accountchooser" in page.url or await _visible(page, CHAMP_MDP) or await _visible(page, CHAMP_ADRESSE):
                return False  # Google demande de se reconnecter
            await asyncio.sleep(0.5)
        return None
    finally:
        try:
            await asyncio.wait_for(contexte.close(), timeout=15)
        except BaseException:
            pass


async def _contexte(etat=None, messagerie="outlook"):
    nav = await navigateur()
    ua = ua_google(nav) if messagerie == "gmail" else \
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    contexte = await nav.new_context(
        storage_state=etat, locale="fr-FR", timezone_id="Europe/Paris", viewport={"width": 1280, "height": 860}, user_agent=ua)
    await contexte.add_init_script(SANS_CLE_ACCES)
    return contexte


def url_messagerie(messagerie="outlook"):
    return config.GMAIL_URL if messagerie == "gmail" else config.OUTLOOK_URL


def _arrive(url, messagerie="outlook"):
    return any(url.startswith(a) for a in (config.GMAIL_ARRIVEE if messagerie == "gmail" else config.OUTLOOK_ARRIVEE))


def _chez_google(url):
    return "accounts.google.com" in url


async def _dans_la_messagerie(page, messagerie="outlook"):
    """Preuve qu'on est VRAIMENT connecté, pas seulement passé par la page de la messagerie :
    1. l'adresse est celle de la messagerie (Outlook ou Gmail) ;
    2. Microsoft ou Google a posé son cookie de session, qu'il ne pose qu'après une
       authentification réussie ;
    3. deux secondes plus tard on y est toujours, sans aucun champ de connexion."""
    if not _arrive(page.url, messagerie):
        return False
    noms = {c["name"] for c in await page.context.cookies()}
    if not noms.intersection(config.COOKIES_GOOGLE if messagerie == "gmail" else config.COOKIES_AUTH):
        return False
    await asyncio.sleep(2)
    return (_arrive(page.url, messagerie) and not await _visible(page, CHAMP_MDP)
            and not await _visible(page, CHAMP_ADRESSE))


async def _visible(page, selecteur):
    """Le premier élément VISIBLE qui correspond (la page de Microsoft garde des
    champs et des boutons masqués avant ceux qu'on voit)."""
    try:
        loc = page.locator(selecteur)
        for i in range(min(await loc.count(), 15)):
            el = loc.nth(i)
            if await el.is_visible():
                b = await el.bounding_box()
                # Visible pour de vrai : une vraie taille, dans la page (pas rejeté hors de l'écran).
                if b and b["width"] > 2 and b["height"] > 2 and b["x"] + b["width"] > 0 and b["y"] + b["height"] > 0:
                    return el
    except Exception:
        pass
    return None


def _chez_microsoft(url):
    return any(h in url for h in ("login.microsoftonline.com", "login.live.com", "login.microsoft.com", "account.live.com"))


async def _texte(page):
    try:
        return await page.locator("body").inner_text(timeout=1000)
    except Exception:
        return ""


async def _cliquer_suivant(page, selecteur=BOUTON_SUIVANT):
    b = await _visible(page, selecteur)
    if b:
        await b.click()


# ------------------------------------------------------------------ limites
def _essai_permis(cle, plafond):
    """Pas plus de `plafond` tentatives par quart d'heure : le serveur ne doit pas
    servir à essayer des mots de passe à la chaîne."""
    maintenant = time.monotonic()
    l = [t for t in _essais.get(cle, []) if maintenant - t < 900]
    if len(l) >= plafond:
        _essais[cle] = l
        return False
    l.append(maintenant)
    _essais[cle] = l
    return True


def _nettoyer():
    maintenant = time.monotonic()
    for k in [k for k, l in _essais.items() if not l or maintenant - l[-1] > 900]:
        _essais.pop(k, None)
    limite = maintenant - config.CONNEXION_DELAI - 120
    for k, c in list(_connexions.items()):
        if c.debut < limite:
            if c.tache and not c.tache.done():
                c.tache.cancel()
            _connexions.pop(k, None)


# ------------------------------------------------------------------ connexion
def demarrer(adresse, mdp, appareil="", ip=""):
    """Lance la connexion en arrière-plan. Rend la Connexion, ou None si trop d'essais."""
    _nettoyer()
    adresse = adresse.strip().lower()
    if not _essai_permis("a:" + adresse, config.ESSAIS_PAR_ADRESSE) or not _essai_permis("ip:" + ip, config.ESSAIS_PAR_IP):
        return None
    c = Connexion(adresse, mdp, appareil, ip)
    _connexions[c.id] = c
    c.tache = asyncio.get_running_loop().create_task(_mener(c))
    return c


def trouver(cid):
    return _connexions.get(cid)


def annuler(cid):
    c = _connexions.pop(cid, None)
    if c and c.tache and not c.tache.done():
        c.tache.cancel()
    return c is not None


def remettre(c):
    """Rend le résultat d'une connexion réussie UNE fois, puis l'oublie."""
    _connexions.pop(c.id, None)
    return c.resultat


async def _mener(c):
    _boucle_prete()
    contexte = page = None
    try:
        async with _places:
            contexte = await _contexte()
            page = await contexte.new_page()
            await asyncio.wait_for(_parcours(c, page), timeout=config.CONNEXION_DELAI)
            etat = await contexte.storage_state()
            _fin(c, etat)
    except asyncio.TimeoutError:
        if page is not None:
            await _diagnostic(c, page, "délai dépassé")
        _echec(c, "delai")
    except asyncio.CancelledError:
        raise
    except _Echec as e:
        if page is not None and e.cle != "desactive":
            await _diagnostic(c, page, f"{e.cle} — {e.trace}")
        _echec(c, e.cle, e.detail)
    except Exception as e:  # navigateur fermé, page cassée… : jamais de trace brute à l'écran
        _echec(c, "inconnu", "")
        print(f"[connexion] {c.adresse} : {type(e).__name__}: {e}", flush=True)
    finally:
        c.mdp = None
        if contexte is not None:
            try:
                await asyncio.wait_for(contexte.close(), timeout=10)
            except BaseException:
                pass


class _Echec(Exception):
    def __init__(self, cle, detail="", trace=""):
        super().__init__(cle)
        self.cle = cle
        self.detail = detail
        self.trace = trace  # pour le diagnostic (jamais le mot de passe)


_RE_MAIL = re.compile(r"[\w.%+-]+@[\w-]+(?:\.[\w-]+)+")


def masquer(texte):
    """Aucune adresse e-mail dans un diagnostic (ni celle de l'étudiant, ni celles des élèves)."""
    return _RE_MAIL.sub("<adresse>", texte or "")


async def _diagnostic(c, page, raison, prive=False):
    """Ce que voyait le serveur au moment de l'échec : adresse de la page (sans ses
    paramètres), champs et boutons visibles (sans leur contenu), capture d'écran.
    Jamais le mot de passe : les champs mot de passe s'affichent masqués. Jamais une
    adresse e-mail : elles sont masquées. « prive » (dans la messagerie même) : ni
    capture ni texte de la page, seulement les fenêtres et boutons visibles. Les 20
    derniers diagnostics sont gardés dans le dossier de la base."""
    # Chaque lecture de la page est bornée : un navigateur mort ou gelé ne doit
    # JAMAIS faire durer le diagnostic (sinon l'échec lui-même ne se termine pas).
    async def borne(aw, defaut=None):
        try:
            return await asyncio.wait_for(aw, timeout=8)
        except BaseException:
            return defaut

    try:
        import hashlib
        dossier = config.BASE.parent / "diagnostics"
        dossier.mkdir(parents=True, exist_ok=True)
        nom = time.strftime("%Y%m%d-%H%M%S") + "-" + hashlib.sha256(c.adresse.encode()).hexdigest()[:8]
        url = (page.url or "").split("?")[0]
        elements = await borne(page.evaluate("""() => Array.from(document.querySelectorAll('input, button, [role=button], [role=alert], [role=dialog]'))
            .filter(e => e.offsetParent !== null)
            .map(e => [e.tagName.toLowerCase(), e.id || '', e.getAttribute('name') || '', e.getAttribute('type') || '',
                       e.getAttribute('data-testid') || '', (e.tagName === 'INPUT' ? '' : (e.innerText || '').trim().slice(0, 80))].join(' | '))"""), []) or []
        texte = "" if prive else (await borne(page.locator("body").inner_text(), "") or "")[:1500]
        domaine = c.adresse.rsplit("@", 1)[-1]
        (dossier / (nom + ".txt")).write_text(masquer(
            f"raison : {raison}\ndomaine : {domaine}\npage : {url}\n\néléments visibles :\n"
            + "\n".join(elements[:150]) + ("" if prive else f"\n\ntexte de la page :\n{texte}") + "\n"))
        if not prive:
            await borne(page.screenshot(path=str(dossier / (nom + ".png"))))
        for vieux in sorted(dossier.glob("*.txt"))[:-20]:
            vieux.unlink(missing_ok=True)
            vieux.with_suffix(".png").unlink(missing_ok=True)
        print(f"[connexion] échec ({raison}) sur {url} — diagnostic {nom}", flush=True)
    except Exception as e:
        print(f"[connexion] diagnostic impossible : {type(e).__name__}: {e}", flush=True)


def _echec(c, cle, detail=""):
    c.mdp = None
    c.etape = "echec"
    c.nombre = ""
    c.message = MESSAGES.get(cle, MESSAGES["inconnu"]) if not detail or cle in ("mdp", "adresse") else detail


async def _parcours(c, page):
    """Avance dans les pages de Microsoft jusqu'à la messagerie."""
    await page.goto(config.OUTLOOK_URL, wait_until="domcontentloaded")
    adresse_saisie = mdp_saisi = code_envoye = False
    mdp_envoye = 0.0
    # Surveillance d'étape inconnue : on note le dernier geste reconnu (saisie, clic,
    # attente légitime d'une validation ou d'un code). Si Microsoft affiche, après le
    # mot de passe, un écran que Smart Mail ne sait pas franchir, on ne tourne pas en
    # rond jusqu'au délai : on s'arrête vite avec un diagnostic de cet écran.
    dernier_geste = time.monotonic()

    def progresse():
        nonlocal dernier_geste
        dernier_geste = time.monotonic()

    while True:
        await asyncio.sleep(0.4)
        if adresse_saisie and await _dans_la_messagerie(page):
            return
        # En attente d'une validation sur le téléphone ou d'un code : c'est normal, on patiente.
        if c.etape in ("validation", "code"):
            progresse()
        elif adresse_saisie and time.monotonic() - dernier_geste > 30:
            await _diagnostic(c, page, "bloqué : étape inconnue")
            raise _Echec("inconnu", detail="Microsoft affiche une étape que Smart Mail ne reconnaît pas encore. "
                                           "Si une application de validation vous le demande, approuvez, puis réessayez.")

        erreur = await _visible(page, ERREURS)
        texte_erreur = (await erreur.inner_text()).strip() if erreur else ""
        if texte_erreur:
            if code_envoye:
                c.message = MESSAGES["code"]  # mauvais code : on laisse réessayer
            elif mdp_saisi:
                raise _Echec("mdp", trace=f"erreur affichée : {texte_erreur[:200]}")
            elif adresse_saisie:
                raise _Echec("adresse", trace=f"erreur affichée : {texte_erreur[:200]}")

        if await _visible(page, CONFIGURER_SECURITE):
            raise _Echec("securite")

        champ = await _visible(page, CHAMP_ADRESSE)
        if champ and not adresse_saisie:
            await champ.fill(c.adresse)
            adresse_saisie = True
            progresse()
            await _cliquer_suivant(page)
            continue

        champ = await _visible(page, CHAMP_MDP)
        if champ and not mdp_saisi and adresse_saisie:
            # Page de l'établissement : identifiant vide à côté du mot de passe → l'adresse.
            ident = await _visible(page, CHAMP_IDENTIFIANT)
            if ident and not (await ident.input_value()).strip():
                await ident.fill(c.adresse)
            await champ.fill(c.mdp or "")
            c.mdp = None  # le mot de passe a servi : on l'oublie
            mdp_saisi = True
            mdp_envoye = time.monotonic()
            progresse()
            await _cliquer_suivant(page)
            continue
        # Portail d'établissement (pas chez Microsoft, qui affiche ses erreurs) : le mot
        # de passe est redemandé, champ vide, longtemps après l'envoi → il a été refusé.
        if (champ and mdp_saisi and not _chez_microsoft(page.url) and time.monotonic() - mdp_envoye > 8
                and not (await champ.input_value())):
            raise _Echec("mdp", trace="mot de passe redemandé par le portail")

        texte = await _texte(page)

        # Page « clé d'accès » : on demande les autres options, puis le mot de passe.
        if not mdp_saisi and ("/fido" in page.url or any(t in texte for t in TEXTES_CLE)):
            option = await _visible(page, OPTION_MDP)
            if option:
                progresse()
                await option.click()
                await asyncio.sleep(1)
                continue
            lien = await _visible(page, LIEN_OPTIONS)
            if lien and time.monotonic() - dernier_geste > 1.5:
                progresse()
                await lien.click()
                await asyncio.sleep(1)
                continue

        # « Rester connecté ? » : oui, c'est ce qui fait durer la session sur le serveur.
        if any(t in texte for t in TEXTES_RESTER):
            case = await _visible(page, CASE_RESTER)
            if case and not await case.is_checked():
                await case.check()
            progresse()
            await _cliquer_suivant(page)
            continue

        # Validation sur le téléphone : un nombre à toucher dans Authenticator.
        nombre = await _visible(page, NOMBRE)
        if nombre:
            c.nombre = (await nombre.inner_text()).strip()
            c.etape = "validation"
            continue
        if any(t in texte for t in TEXTES_VALIDATION) and not await _visible(page, CHAMP_CODE):
            c.etape = "validation"
            if "refus" in texte.lower() or "denied" in texte.lower():
                raise _Echec("refus")
            continue

        # Choix de la méthode : la première proposée (en général l'application).
        methode = await _visible(page, CHOIX_METHODE)
        if methode:
            progresse()
            await methode.click()
            continue

        # Code reçu par SMS ou affiché dans l'application.
        champ = await _visible(page, CHAMP_CODE)
        if champ:
            c.etape = "code"
            c.nombre = ""
            code = await c.code_saisi.get()
            c.message = ""
            await champ.fill(code)
            code_envoye = True
            await _cliquer_suivant(page, BOUTON_CODE)
            await asyncio.sleep(1.0)
            continue


def terminer(adresse, appareil, etat, messagerie="outlook"):
    """Connexion réussie (quelle que soit la façon) : le compte (créé à la première
    fois), la session Outlook rangée chiffrée, et une session Smart Mail pour cet
    appareil. Rend {code, nom, email, role} ; lève _Echec si l'accès est coupé."""
    adresse = adresse.strip().lower()
    if config.DOMAINES and adresse.rsplit("@", 1)[-1] not in config.DOMAINES:
        raise _Echec("domaine", "Utilisez l'adresse de votre établissement.")
    role = "administrateur" if adresse in config.ADMINS else "ambassadeur"
    u, _ = base.compte_outlook(adresse, role=role)
    if adresse in config.ADMINS and u["role"] != "administrateur":
        base.definir_role(u["id"], "administrateur")
        u["role"] = "administrateur"
    if not u["actif"]:
        raise _Echec("desactive", "Votre accès Smart Mail est désactivé. Contactez un administrateur.")
    base.outlook_ecrire(u["id"], adresse, coffre.fermer(json.dumps(etat)), messagerie)
    jeton = base.ouvrir_session(u["id"], appareil)
    base.journal_noter(u["id"], "session", f"Connexion {'Gmail' if messagerie == 'gmail' else 'universelle' if messagerie == 'universel' else 'Outlook'} réussie ({appareil or 'appareil'}) : "
                                           "session enregistrée sur le serveur.", "succes")
    return {"code": jeton, "nom": u["nom"], "email": u.get("email") or adresse, "role": u["role"]}


def _fin(c, etat):
    c.resultat = terminer(c.adresse, c.appareil, etat)
    c.etape = "reussie"
    c.nombre = ""
    c.message = ""


# ------------------------------------------------------------------ la session vit
def etat_session(uid):
    o = base.outlook_lire(uid)
    if not o:
        return {"connecte": False}
    return {"connecte": True, "adresse": o["adresse"], "depuis": o["connecte"], "verifie": o["verifie"],
            "messagerie": o.get("messagerie") or "outlook"}


async def ouvrir(uid, detail=None):
    """Rouvre la session Outlook gardée par le serveur, dans un contexte neuf.
    Rend (contexte, page) arrivés dans la messagerie, ou None si Microsoft
    demande de se reconnecter. À refermer avec `ranger(uid, contexte)`.
    detail (dict) : detail["connexion"] = True seulement si Microsoft a VRAIMENT demandé
    l'adresse ou le mot de passe (sinon c'est Outlook qui ne répond pas : panne, lenteur)."""
    o = base.outlook_lire(uid)
    if not o:
        return None
    try:
        etat = json.loads(coffre.ouvrir(o["etat"]) or "null")
    except ValueError:
        etat = None
    if not etat:
        return None
    messagerie = o.get("messagerie") or "outlook"
    contexte = await _contexte(etat, messagerie)
    page = await contexte.new_page()
    try:
        await page.goto(url_messagerie(messagerie), wait_until="domcontentloaded")
        fin = time.monotonic() + 30
        while time.monotonic() < fin:
            if await _dans_la_messagerie(page, messagerie):
                return contexte, page
            if await _visible(page, CHAMP_MDP) or await _visible(page, CHAMP_ADRESSE):
                if detail is not None:
                    detail["connexion"] = True
                break
            await asyncio.sleep(0.4)
    except Exception:
        pass
    await contexte.close()
    return None


async def ranger(uid, contexte):
    """Garde les cookies renouvelés par Microsoft, puis referme."""
    try:
        base.outlook_rafraichir(uid, coffre.fermer(json.dumps(await contexte.storage_state())))
    finally:
        await contexte.close()


async def verifier(uid):
    """La session Outlook gardée par le serveur ouvre-t-elle toujours la messagerie ?
    Oui : on la renouvelle. Non : on l'oublie, la personne devra se reconnecter."""
    if (base.outlook_infos(uid) or {}).get("messagerie") == "universel":
        from . import universel  # connexion universelle : IMAP/SMTP, aucun navigateur
        return await universel.verifier_compte(uid)
    _boucle_prete()
    if profil_gmail(uid):
        async with verrou_profil(uid):
            async with _places:
                ok = await _verifier_profil_gmail(uid)
        if ok is False and base.outlook_lire(uid):
            base.outlook_oublier(uid)
            base.journal_noter(uid, "session", "Google a fermé la session Gmail : l'ambassadeur doit se reconnecter "
                                               "dans l'application (sa liste et sa recherche sont gardées).", "critique")
        return ok is not False
    if not base.outlook_lire(uid):
        return False  # aucune session : rien à vérifier, l'ambassadeur doit se reconnecter
    async with _places:
        detail = {}
        ouvert = await ouvrir(uid, detail)
        if not ouvert and not detail.get("connexion"):
            # Outlook ne répond pas (panne Microsoft du 12/11, lenteur) : la session n'est PAS
            # effacée ; seule une vraie demande de connexion de Microsoft l'efface.
            base.journal_noter(uid, "session", "Vérification de la session impossible (Outlook ne répond pas) : "
                                               "session gardée, nouvel essai plus tard.", "attention")
            return True
        if not ouvert:
            if base.outlook_lire(uid):
                base.outlook_oublier(uid)
                base.journal_noter(uid, "session", "Session de messagerie expirée : l'ambassadeur doit se reconnecter "
                                                   "dans l'application (sa liste et sa recherche sont gardées).", "attention")
            return False
        await ranger(uid, ouvert[0])
        return True


RENOUVELER_HEURES = 6                 # chaque session est rouverte au moins toutes les 6 h
AVANT_ENVOI = (24 * 3600, 3 * 3600, 1800)  # contrôles avant un envoi programmé : veille, 3 h, 30 min
_controles_faits = set()


def _occupe(uid):
    """Une tâche tourne sur ce compte : elle renouvelle la session elle-même (et sur Gmail, un seul
    navigateur à la fois)."""
    from . import travaux
    for ty in ("annuaire", "envoi", "test"):
        t = travaux.en_cours(uid, ty) if ty != "test" else travaux._tests.get(uid)
        if t and getattr(t, "page", None) is not None and not getattr(t, "termine", False):
            return True  # navigateur ouvert (un envoi qui attend son heure n'en a pas encore)
    return False


def _a_controler(maintenant_ts):
    """(uid, raison) des sessions à rouvrir maintenant."""
    limite = (base.maintenant() - timedelta(hours=RENOUVELER_HEURES)).isoformat()
    with base._verrou:
        vieilles = [r[0] for r in base.cnx().execute(
            "SELECT utilisateur_id FROM outlook WHERE etat != '' AND (verifie = '' OR verifie < ?)", (limite,))]
        attentes = [(r[0], r[1]) for r in base.cnx().execute(
            "SELECT utilisateur_id, params FROM taches WHERE type = 'envoi' AND statut = 'attente'")]
    out = [(u, "toutes les 6 h") for u in vieilles]
    for uid, params in attentes:
        try:
            debut = float((json.loads(params or "{}") or {}).get("debut") or 0)
        except ValueError:
            continue
        if not debut or maintenant_ts >= debut:
            continue
        dues = [(uid, round(debut), a) for a in AVANT_ENVOI if debut - a <= maintenant_ts]
        nouvelles = [c for c in dues if c not in _controles_faits]
        _controles_faits.update(dues)  # toutes les échéances déjà atteintes : un seul contrôle
        if nouvelles and uid not in [u for u, _ in out]:
            out.append((uid, f"avant l'envoi de {time.strftime('%H:%M', time.localtime(debut))}"))
    return out


async def entretien(heures=None):
    """Tâche de fond : toutes les 15 min, chaque session pas vérifiée depuis 6 h est rouverte (ce qui la
    renouvelle côté Microsoft/Google), et chaque compte avec un envoi programmé est contrôlé la veille,
    3 h et 30 min avant. Ne dépend plus de la durée depuis le dernier redémarrage."""
    await asyncio.sleep(300)  # laisser les travaux reprendre après un démarrage
    while True:
        for uid, raison in _a_controler(time.time()):
            if _occupe(uid):
                continue
            try:
                avait = bool(base.outlook_lire(uid))
                if not avait:
                    base.journal_noter(uid, "session", f"Contrôle {raison} : aucune session de messagerie, l'ambassadeur doit se "
                                                       "reconnecter. L'envoi partira tout seul dès qu'il l'aura fait.", "critique")
                    continue
                ok = await verifier(uid)
                if avait and not base.outlook_lire(uid):
                    base.journal_noter(uid, "session", f"Contrôle {raison} : la messagerie demande une reconnexion. "
                                                       "Relancez l'ambassadeur avant l'envoi.", "critique")
                elif not ok:
                    base.journal_noter(uid, "session", f"Contrôle {raison} : la session n'a pas pu être vérifiée.", "attention")
            except Exception as e:
                print(f"[entretien] compte {uid} : {type(e).__name__}: {e}", flush=True)
        await asyncio.sleep(900)
