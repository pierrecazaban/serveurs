"""Le travail du serveur pour chaque étudiant : regrouper l'annuaire, puis envoyer.

Le serveur ouvre Outlook web avec la session Outlook gardée pour le compte, dans
un Chromium où tourne l'extension Smart Mail (dossier extension/), et pilote ses
deux panneaux comme le ferait la personne :
  - « Regrouper l'annuaire » : bouton « Démarrer » du relevé. Chaque adresse
    relevée est triée au fil de l'eau (règles, format de l'école, Claude) et les
    élèves entrent dans la liste du compte, jusqu'à l'objectif.
  - « Lancer l'envoi » : la liste des élèves, l'objet et le message vont dans le
    panneau d'envoi, au rythme choisi, dans la plage horaire choisie.

Toute la sûreté d'envoi est celle de l'extension, éprouvée par ses tests : jamais
deux fois la même personne (liste « Déjà envoyés »), jamais un autre destinataire,
arrêt sans envoi sur tout état inattendu, « à vérifier » après une coupure. Le
serveur n'ajoute qu'une chose : il ne fait que retirer des destinataires (tri),
jamais en inventer.

La mémoire de l'extension (campagne en cours, « Déjà envoyés ») est rangée
chiffrée avec le compte : après un redémarrage du serveur, le travail reprend
exactement là où il en était.
"""

import asyncio
import json
import os
import shutil
import tempfile
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi.concurrency import run_in_threadpool
from playwright.async_api import TimeoutError as PlaywrightTimeout

from . import base, coffre, config, logique as logique_mod, navigateur, rebonds, service

# Pour les tests : fonction async(contexte) qui sert de fausses pages Outlook.
installer_routes = None

_travaux = {}  # (uid, type) -> Travail : une recherche ET un envoi peuvent tourner ensemble
_tests = {}    # uid -> Travail (message test : à tout moment, à côté du reste)
_etats_test = {}  # uid -> {statut, message, maj}
_places = None


class ErreurTravail(Exception):
    pass


async def _diag(t, raison):
    """Erreur inattendue : ce que voyait le navigateur (fenêtres et boutons visibles,
    adresses masquées ; ni capture ni contenu de la messagerie)."""
    if t.page is None:
        return
    u = base.utilisateur_par_id(t.uid) or {}
    c = type("C", (), {"adresse": u.get("email") or "inconnu@inconnu"})()
    try:
        await asyncio.wait_for(navigateur._diagnostic(c, t.page, raison, prive=True), timeout=30)
    except BaseException:
        pass


class Travail:
    def __init__(self, uid, type_):
        self.uid = uid
        self.type = type_
        self.arret = asyncio.Event()
        self.tache = None
        self.page = None  # pour les tests
        self.termine = False  # statut final écrit : le navigateur se ferme, ce n'est plus « en cours »
        self.params = None  # les réglages du travail (l'objectif d'une recherche peut changer en route)
        self.debut = None  # envoi programmé : heure de départ (epoch), modifiable pendant l'attente
        self.collage = None  # Gmail : l'assistant de collage (vrai Ctrl+V) pendant l'envoi


def _place():
    global _places
    if _places is None:
        _places = asyncio.Semaphore(max(1, config.NAVIGATEURS_MAX))
    return _places


def en_cours(uid, type_):
    t = _travaux.get((uid, type_))
    return t if t and t.tache and not t.tache.done() and not t.termine else None


def charge():
    """Navigateurs vraiment ouverts (recherches, envois, tests). Un envoi programmé qui attend
    son heure, ou un travail qui attend un navigateur libre, n'en occupe pas."""
    def ouvert(t):
        return bool(t and t.page is not None)
    utilises = sum(1 for (uid, ty) in list(_travaux) if ty in ("annuaire", "envoi") and ouvert(en_cours(uid, ty)))
    utilises += sum(1 for uid in list(_tests) if ouvert(test_en_cours(uid)))
    return {"navigateurs": utilises, "maximum": config.NAVIGATEURS_MAX}


def etat(uid, type_):
    t = base.travail_lire(uid, type_)
    actif = bool(en_cours(uid, type_))
    if not t:
        return {"type": type_, "statut": "aucun", "progression": {}, "message": "", "actif": False}
    s = _suivi.get((uid, type_)) or {}
    prog = t["progression"]
    if type_ == "annuaire" and (t["params"] or {}).get("objectif"):
        prog["objectif"] = t["params"]["objectif"]  # l'objectif choisi, même changé en route
    return {"type": type_, "statut": t["statut"], "progression": prog, "message": t["message"],
            "maj": t["maj"], "actif": actif, "progres": s.get("progres") if actif else None}


def changer_objectif(uid, objectif):
    """L'objectif de la recherche, changé à tout moment : pris en compte tout de suite si elle
    tourne (au prochain tour de sa boucle), et gardé pour sa reprise sinon."""
    objectif = int(objectif)
    t = en_cours(uid, "annuaire")
    if t and t.params is not None:
        t.params["objectif"] = objectif
    e = base.travail_lire(uid, "annuaire")
    if e:
        params, prog = dict(e["params"] or {}), dict(e["progression"] or {})
        params["objectif"] = prog["objectif"] = objectif
        base.travail_ecrire(uid, "annuaire", e["statut"], params, prog, e["message"])
    return objectif


def programmer(uid, debut):
    """Un envoi programmé change d'heure (ou part tout de suite : debut = None). Vrai si un
    envoi attendait bien son heure."""
    t = en_cours(uid, "envoi")
    if not t or not t.debut:
        return False
    t.debut = float(debut) if debut else time.time()
    if t.params is not None:
        t.params["debut"] = t.debut
    return True


def quand_fr(ts):
    d = datetime.fromtimestamp(ts, ZoneInfo(config.FUSEAU))
    return f"le {JOURS[d.weekday()]} {d.day} {MOIS[d.month - 1]} à {d.hour} h {d.minute:02d} (heure de {config.FUSEAU.split('/')[-1]})"


# ------------------------------------------------------------------ journal et progrès (console)
NOMS = {"annuaire": "Recherche", "tri": "Tri", "envoi": "Envoi", "test": "Message test"}
_suivi = {}  # (uid, type) -> dernier statut, dernier message, dernier progrès réel, paliers passés
# Messages « en cours » qui méritent une ligne du journal (une seule fois de suite).
_NOTABLES = ("Pack terminé", "Hors de la plage horaire", "nouveaux élèves trouvés", "Tous les élèves trouvés ont reçu")
# Paliers : une ligne tous les N (élèves trouvés, contacts extraits, élèves servis).
_PALIERS = {"annuaire": (("trouves", 1000, "{n} élèves trouvés."), ("extraits", 5000, "{n} contacts extraits de l'annuaire.")),
            "envoi": (("envoyes", 100, "{n} élèves ont reçu le message."),)}
_SIGNATURES = {"annuaire": ("releves", "extraits", "trouves", "ecartes"), "tri": ("tries", "total"),
               "envoi": ("curseur", "envoyes", "a_verifier", "echecs", "deja", "total")}


def _niveau(statut, message):
    m = (message or "").lower()
    if statut == "erreur":
        return "critique" if any(x in m for x in ("bloqué", "indisponible", "crédit", "session", "reconnect")) else "attention"
    if statut == "pause":
        return "critique" if "bloqué" in m else "attention" if "prudence" in m else "info"
    if statut == "fini":
        return "info" if "pause" in m or "clos" in m else "succes"
    return "info"


_MOTS = {"annuaire": ("recherche", "relevé", "annuaire", "extraction"), "tri": ("tri",), "envoi": ("envoi",), "test": ("test",)}


def _phrase(type_, message):
    """« Recherche : … » devant un message qui ne dit pas déjà de quel travail il s'agit."""
    debut = (message or "")[:40].lower()
    return message if any(m in debut for m in _MOTS.get(type_, ())) else f"{NOMS.get(type_, type_)} : {message}"


def _nombre(n):
    return f"{n:,}".replace(",", "\u202f")


def _journaliser(uid, type_, statut, params, progression, message):
    """Ce que la console doit savoir : changements d'état, paliers, avis « non distribué »,
    et l'heure du dernier vrai progrès (pour repérer un travail qui n'avance plus)."""
    p, maintenant, nom = progression or {}, time.time(), NOMS.get(type_, type_)
    signature = tuple(p.get(k) for k in _SIGNATURES.get(type_, ()))
    s = _suivi.get((uid, type_))
    if s is None:
        s = _suivi[(uid, type_)] = {
            "statut": None, "message": "", "signature": signature, "progres": maintenant,
            "paliers": {k: int(p.get(k) or 0) // pas for k, pas, _ in _PALIERS.get(type_, ())},
            "non_distribues": int(p.get("non_distribues") or 0)}
        if statut in ("attente", "en_cours") and (params or {}).get("reprise"):
            base.journal_noter(uid, type_, f"{nom} : reprise automatique après le redémarrage du serveur.")
    if signature != s["signature"]:
        s["signature"], s["progres"] = signature, maintenant
    changement = statut != s["statut"]
    if changement and statut in ("pause", "erreur", "fini") and message:
        base.journal_noter(uid, type_, _phrase(type_, message), _niveau(statut, message))
    if statut == "en_cours":
        if changement:
            s["progres"] = maintenant
        notable = next((m for m in _NOTABLES if m in (message or "")), None)
        if notable and (changement or message != s["message"]) and notable not in (s["message"] or ""):
            base.journal_noter(uid, type_, _phrase(type_, message))
    s["statut"], s["message"] = statut, message
    for k, pas, modele in _PALIERS.get(type_, ()):
        palier = int(p.get(k) or 0) // pas
        if palier > s["paliers"].get(k, 0):
            base.journal_noter(uid, type_, f"{nom} : " + modele.format(n=_nombre(palier * pas)), "succes")
        s["paliers"][k] = palier
    nd = int(p.get("non_distribues") or 0)
    if nd > s["non_distribues"]:
        base.journal_noter(uid, type_, f"{nom} : {nd - s['non_distribues']} élève(s) n'ont pas reçu le message "
                                       f"(adresse introuvable). L'envoi continue.", "attention")
    s["non_distribues"] = nd


def _maj(uid, type_, statut, params, progression, message=""):
    if type_ == "test":  # le test ne touche jamais à l'état du relevé ou de l'envoi
        if statut in ("fini", "erreur") and (_etats_test.get(uid) or {}).get("statut") != statut:
            try:
                base.journal_noter(uid, "test", _phrase("test", message), "succes" if statut == "fini" else "attention")
            except Exception:
                pass
        _etats_test[uid] = {"statut": statut, "message": message, "maj": time.time()}
        t = _tests.get(uid)
        if t and statut in ("fini", "erreur", "pause"):
            t.termine = True
        return
    base.travail_ecrire(uid, type_, statut, params, progression, message)
    try:
        _journaliser(uid, type_, statut, params, progression, message)
    except Exception as x:  # le journal ne doit jamais arrêter un travail
        print(f"[journal] {type(x).__name__}: {x}", flush=True)
    if statut in ("fini", "erreur", "pause"):
        t = _travaux.get((uid, type_))
        if t:
            t.termine = True


# ------------------------------------------------------------------ navigateur avec l'extension
async def _ouvrir(uid):
    """Chromium avec l'extension, la session Outlook du compte et la mémoire de
    l'extension. Rend (pw, contexte, page, service_worker, dossier)."""
    o = base.outlook_lire(uid)
    if not o:
        raise ErreurTravail("Aucune session Outlook sur le serveur : reconnectez-vous.")
    try:
        etat_nav = json.loads(coffre.ouvrir(o["etat"]) or "null") or {}
    except ValueError:
        etat_nav = {}
    if not etat_nav.get("cookies"):
        raise ErreurTravail("La session Outlook est illisible : reconnectez-vous.")
    if not (config.EXTENSION_DIR / "manifest.json").exists():
        raise ErreurTravail("Extension Smart Mail introuvable sur le serveur.")
    from playwright.async_api import async_playwright
    fixe = navigateur.profil_gmail(uid)  # Google : le profil de la connexion, jamais une copie des cookies
    if fixe:
        verrou = navigateur.verrou_profil(uid)
        await verrou.acquire()  # jamais deux navigateurs à la fois sur ce compte
        dossier = str(navigateur.dossier_profil(uid))
        _PROFILS_TENUS[dossier] = verrou
    else:
        dossier = tempfile.mkdtemp(prefix="smartmail-profil-")
    pw = await async_playwright().start()
    try:
        ext = str(config.EXTENSION_DIR)
        if fixe:
            contexte = await navigateur.lancer_profil_gmail(pw, dossier, extension=True)
        else:
            ua = {}
            if (o.get("messagerie") or "outlook") == "gmail":
                ua = {"user_agent": navigateur.ua_google(await navigateur.navigateur())}  # comme à la connexion Google
            contexte = await pw.chromium.launch_persistent_context(
                dossier, channel="chromium", headless=not config.NAVIGATEUR_VISIBLE,
                args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}",
                      "--disable-blink-features=AutomationControlled"],
                locale="fr-FR", timezone_id=config.FUSEAU, viewport={"width": 1366, "height": 900}, **ua)
        if installer_routes:
            await installer_routes(contexte)
        if not fixe:
            await contexte.add_cookies(etat_nav["cookies"])
        sw = contexte.service_workers[0] if contexte.service_workers else await contexte.wait_for_event("serviceworker", timeout=20000)
        memoire = (json.loads(await run_in_threadpool(coffre.ouvrir, o.get("extension") or "") or "{}")
                   if o.get("extension") else {})
        # « Relevé en cours » noté par un navigateur qui n'existe plus (serveur redémarré,
        # travail interrompu) : sinon l'extension croit qu'un autre onglet relève encore
        # et refuse de démarrer pendant 30 s.
        memoire = {k: v for k, v in memoire.items() if k not in ("actif-outlook", "actif-gmail")}
        if memoire:
            await sw.evaluate("d => chrome.storage.local.set(d)", memoire)
        page = contexte.pages[0] if contexte.pages else await contexte.new_page()
        return pw, contexte, page, sw, dossier
    except BaseException:
        await pw.stop()
        _liberer(dossier)
        raise


def _part(type_):
    """La part de la mémoire de l'extension qui revient à chaque travail : l'envoi
    range sa campagne et « Déjà envoyés » (clés pp-…), la recherche tout le reste
    (annuaire relevé, reprise du relevé). Le test ne range rien : il tourne sur une
    copie et ne doit jamais écraser ce que font les autres."""
    if type_ == "envoi":
        return lambda k: k.startswith("pp-")
    if type_ == "annuaire":
        return lambda k: not k.startswith("pp-")
    return None


async def _ranger(uid, contexte, sw, type_):
    """Garde les cookies renouvelés par Microsoft et SA part de la mémoire de l'extension."""
    garder = _part(type_)
    if garder:
        try:
            memoire = await sw.evaluate("() => chrome.storage.local.get(null)")
            # Chiffrer et écrire hors de la boucle : le serveur reste disponible pendant ce temps.
            await run_in_threadpool(base.outlook_extension_fusionner, uid, memoire, garder)
        except Exception:
            pass
    try:
        etat = await contexte.storage_state()
        await run_in_threadpool(lambda: base.outlook_rafraichir(uid, coffre.fermer(json.dumps(etat))))
    except Exception:
        pass


_PROFILS_TENUS = {}  # dossier du profil Google fixe -> verrou du compte (libéré à la fermeture)


def _liberer(dossier):
    """Profil Google fixe : on le garde et on rend la main. Profil jetable : on l'efface."""
    verrou = _PROFILS_TENUS.pop(dossier, None)
    if verrou is not None:
        if verrou.locked():
            verrou.release()
    else:
        shutil.rmtree(dossier, ignore_errors=True)


async def _fermer(pw, contexte, dossier):
    for f in (contexte.close, pw.stop):
        try:
            await asyncio.wait_for(f(), timeout=15)
        except BaseException:
            pass
    _liberer(dossier)


def _messagerie(uid):
    return (base.outlook_lire(uid) or {}).get("messagerie") or "outlook"


async def _aller_dans_gmail(page, panneau="adresses"):
    """Gmail : la boîte s'ouvre, le panneau de l'extension (« Adresses » ou « Envoi ») est prêt."""
    await page.goto(config.GMAIL_URL, wait_until="domcontentloaded")
    pret = '[data-pp-panneau][data-pp-pret="1"]' if panneau == "envoi" else '[data-testid="ao-panel"][data-ao-ready="1"]'
    fin = time.monotonic() + 90
    choix_fait = False
    while time.monotonic() < fin:
        if navigateur._arrive(page.url, "gmail") and await page.locator(pret).count():
            return
        if navigateur._chez_google(page.url) and "accountchooser" in page.url:
            # « Choisissez un compte » : Google a fermé la session ; un clic sur le compte suffit souvent.
            compte = page.locator("[data-identifier]").first
            if not choix_fait and await compte.count():
                choix_fait = True
                try:
                    await compte.click(timeout=10000)
                except Exception:
                    pass
                await asyncio.sleep(2)
                continue
            if choix_fait:
                raise ErreurTravail("Google demande de se reconnecter : reconnectez-vous avec Gmail dans l'application.")
        if navigateur._chez_google(page.url) and (await navigateur._visible(page, navigateur.CHAMP_MDP)
                                                  or await navigateur._visible(page, navigateur.CHAMP_ADRESSE)):
            raise ErreurTravail("Google demande de se reconnecter : reconnectez-vous avec Gmail dans l'application.")
        await asyncio.sleep(0.5)
    try:  # de quoi comprendre (adresse de la page sans paramètres, panneau de l'extension présent ou non)
        from urllib.parse import urlsplit
        u = urlsplit(page.url)
        print(f"[gmail] pas ouvert : {u.netloc}{u.path[:60]} · panneau={await page.locator('[data-testid=\"ao-panel\"]').count()} "
              f"· pret={await page.locator(pret).count()} · titre={(await page.title())[:40]!r}", flush=True)
    except Exception:
        pass
    raise ErreurTravail("Gmail ne s'est pas ouvert. Réessayez dans un instant.")


# Gmail : le relevé tape dans « À » d'un nouveau message (bouton « Nouveau message » : gh="cm").
GMAIL_A = ('div[name="to"] input[peoplekit-id], div[name="to"] input, input[aria-label="To recipients"], '
           'input[aria-label="À destinataires"], div[name="to"] [role="combobox"][aria-autocomplete="list"]')
# (jamais un [role=combobox] seul : c'est aussi la barre de recherche de Gmail)
GMAIL_NOUVEAU = 'div[gh="cm"], .aic [role="button"], .T-I.T-I-KE.L3[role="button"]'  # (nouvelle présentation : plus de gh="cm")
GMAIL_PRET = GMAIL_NOUVEAU + ', ' + GMAIL_A


async def _redaction_gmail(page):
    """Ouvre « Nouveau message » si besoin : il faut un champ « À » pour relever l'annuaire."""
    if await navigateur._visible(page, GMAIL_A):
        return True
    bouton = await navigateur._visible(page, GMAIL_NOUVEAU)
    if bouton:
        await bouton.click()
    fin = time.monotonic() + 15
    while time.monotonic() < fin:
        if await navigateur._visible(page, GMAIL_A):
            return True
        await asyncio.sleep(0.5)
    return False


async def _aller_dans_outlook(page):
    await page.goto(config.OUTLOOK_URL, wait_until="domcontentloaded")
    fin = time.monotonic() + 90
    while time.monotonic() < fin:
        if navigateur._arrive(page.url) and await page.locator('html[data-mega-pret="1"]').count():
            return
        # Renvoyé vers la page de connexion de Microsoft : la session a expiré. (Un champ
        # e-mail dans Outlook même, comme « À », ne veut rien dire.)
        if navigateur._chez_microsoft(page.url) and (await navigateur._visible(page, navigateur.CHAMP_MDP)
                                                     or await navigateur._visible(page, navigateur.CHAMP_ADRESSE)):
            raise ErreurTravail("Microsoft demande de se reconnecter : reconnectez-vous dans l'application.")
        await asyncio.sleep(0.5)
    raise ErreurTravail("Outlook ne s'est pas ouvert. Réessayez dans un instant.")


# Outlook s'affiche par morceaux : l'extension est prête avant les boutons d'Outlook.
# On attend « Nouveau message » (ou un message déjà ouvert) avant de la faire travailler.
OUTLOOK_PRET = ('button[aria-label="Nouveau message"], button[aria-label="New mail"], button[aria-label="New message"], '
                '[role=button][aria-label="Nouveau message"], input[aria-label="To"], input[aria-label="À"], '
                '[aria-label="À"][contenteditable], [aria-label="To"][contenteditable]')


async def _attendre_outlook_pret(page, delai=60, messagerie="outlook"):
    fin = time.monotonic() + delai
    while time.monotonic() < fin:
        if await navigateur._visible(page, GMAIL_PRET if messagerie == "gmail" else OUTLOOK_PRET):
            await asyncio.sleep(1.5)  # le reste de l'interface finit d'arriver
            return True
        await asyncio.sleep(0.5)
    return False


def _ao(page):
    return page.locator('[data-testid="ao-panel"]')


def _pp(page):
    return page.locator("[data-pp-panneau]")


async def _patient(fn, essais=10, pause=5):
    """Outlook surchargé (grosse mémoire d'annuaire à recharger, serveur chargé) : la page peut ne
    pas répondre pendant plusieurs dizaines de secondes. On réessaie (jusqu'à ~5 min) au lieu
    d'abandonner le travail."""
    for i in range(essais):
        try:
            return await fn()
        except PlaywrightTimeout:
            if i == essais - 1:
                raise
            await asyncio.sleep(pause)


async def _onglet(page, nom):
    """Affiche l'onglet « adresses » ou « envoi » du panneau de l'extension (patient si Outlook est occupé)."""
    return await _patient(lambda: _onglet_brut(page, nom))


async def _onglet_brut(page, nom):
    voulu, autre = (_ao(page), _pp(page)) if nom == "adresses" else (_pp(page), _ao(page))
    if not await voulu.is_visible() and await autre.locator(f'.mega-tab[data-onglet="{nom}"]').count():
        await autre.locator(f'.mega-tab[data-onglet="{nom}"]').click()  # Outlook : deux onglets ; Gmail : « Adresses » seul
    await voulu.wait_for(state="visible", timeout=10000)
    return voulu


async def _actif(page, nom):
    """La pastille verte de l'onglet : le relevé (adresses) ou l'envoi tourne."""
    for panneau in (_ao(page), _pp(page)):
        if await panneau.is_visible():
            p = panneau.locator(f'.mega-tab[data-onglet="{nom}"] .pastille')
            if await p.count():
                return await p.is_visible()
    # Gmail (panneau « Adresses » seul, sans onglets) : son repère « relevé en cours ».
    if nom == "adresses":
        return await page.locator('[data-testid="ao-panel"][data-ao-actif="1"]').count() > 0
    return False


async def _texte(loc):
    try:
        return ((await loc.text_content(timeout=2000)) or "").strip()
    except Exception:
        return ""


# ------------------------------------------------------------------ démarrage, arrêt, reprise
def test_en_cours(uid):
    t = _tests.get(uid)
    return t if t and t.tache and not t.tache.done() and not t.termine else None


def etat_test(uid):
    return _etats_test.get(uid) or {"statut": "aucun", "message": ""}


# Outlook gelé (page surchargée, Microsoft lent) : on attend au lieu de s'arrêter, puis on
# relance tout seul. Rien n'est perdu ni fait deux fois (même mécanisme qu'un redémarrage).
GELS_MAX = 15  # relevés de suite sans réponse d'Outlook (environ 10 minutes : une grosse mémoire peut être longue à recharger)
RELANCES_MAX = 3  # relances automatiques de suite, sans progrès entre deux
DELAI_RELANCE = 60  # secondes (les tests la raccourcissent)
OUTLOOK_GELE = "Outlook ne répondait plus (page surchargée) : nouvel essai automatique dans une minute…"


_RELANCES = set()  # relances automatiques en attente (références gardées)


def _relancer_plus_tard(uid, type_, params, message):
    """Après un gel d'Outlook : le travail attend une minute puis repart tout seul, là où il en
    était (au plus RELANCES_MAX fois de suite sans progrès). Rend vrai s'il repartira."""
    n = int(params.get("relances_auto") or 0)
    if n >= RELANCES_MAX:
        return False
    p = dict(params)
    p["relances_auto"], p["reprise"] = n + 1, True
    p.pop("_abandon_autorise", None)

    async def plus_tard():
        await asyncio.sleep(DELAI_RELANCE)
        # L'ancien travail ferme peut-être encore son navigateur gelé : on attend qu'il ait fini.
        fin = time.monotonic() + 300
        while en_cours(uid, type_) and time.monotonic() < fin:
            await asyncio.sleep(5)
        e = base.travail_lire(uid, type_)
        if e and e["statut"] == "attente" and e["message"] == message and not en_cours(uid, type_):
            try:
                lancer(uid, type_, p)
            except ErreurTravail:
                pass
    # Une tâche asyncio sans référence peut disparaître avant de s'exécuter : on la garde.
    tache = asyncio.get_running_loop().create_task(plus_tard())
    _RELANCES.add(tache)
    tache.add_done_callback(_RELANCES.discard)
    return True


async def _sans_origine(coro):
    """Un travail lancé depuis un écran de la console : seule la demande porte « depuis la
    console » dans le journal, pas tout ce que le travail fait ensuite tout seul."""
    base.ORIGINE.set("")
    return await coro


def lancer_test(uid, params):
    """Message test à soi-même, possible à tout moment, même pendant un relevé ou un envoi."""
    if test_en_cours(uid):
        raise ErreurTravail("Un message test est déjà en cours d'envoi.")
    t = Travail(uid, "test")
    _tests[uid] = t
    _maj(uid, "test", "attente", params, {}, "Envoi du test depuis votre Outlook…")
    t.tache = asyncio.get_running_loop().create_task(_sans_origine(_envoyer(t, params)))
    return t


def maj_envoi(uid, changer):
    """Change les réglages d'un envoi programmé ou en cours, dans la mémoire du travail (pris en compte
    en direct) et dans la base (gardé après un redémarrage)."""
    t = en_cours(uid, "envoi")
    if t and t.params is not None:
        changer(t.params)
        t.params["_reregler"] = True
        if t.debut and t.params.get("sommeil"):
            t.debut = time.time()  # endormi (longue attente) : il se réveille et recalcule son heure avec les nouveaux réglages
    e = base.travail_lire(uid, "envoi")
    if e and e["statut"] != "fini":
        params = dict(e["params"] or {})
        if isinstance(params.get("parametres"), dict):
            params["parametres"] = dict(params["parametres"])
        changer(params)
        params.pop("_reregler", None)
        base.travail_ecrire(uid, "envoi", e["statut"], params, e["progression"] or {}, e["message"] or "")
        return True
    return bool(t)


BLOCAGE_ATTENTE = 24 * 3600  # règle pour TOUTES les écoles : 24 h d'attente après un blocage…
MODE_BLOCAGE = {"pack": 1, "destinataires": 90, "attente": 1430, "max_jour": 90}  # … puis le rythme d'IESEG et SKEMA


def _reprendre_apres_blocage(uid, params):
    """Boîte bloquée par la messagerie (5.1.8…) : l'envoi repart tout seul 24 h plus tard, à la première
    heure de la plage d'envoi, au rythme d'IESEG et SKEMA (1 mail de 90 étudiants par jour). Une école
    sur le pilote automatique : c'est le pilote qui applique cette même règle."""
    from . import pilote
    if pilote.lire(uid):
        return
    d = base.parametres_lire(uid) or {}
    d.update(MODE_BLOCAGE)
    d["taille_pack"] = 1
    base.parametres_ecrire(uid, d)
    nouveaux = dict(params)
    nouveaux["parametres"] = {**(params.get("parametres") or {}), **MODE_BLOCAGE, "taille_pack": 1}
    nouveaux["debut"] = time.time() + BLOCAGE_ATTENTE
    nouveaux["blocages"] = int(params.get("blocages") or 0) + 1
    for k in ("reprise_a", "pack_debut", "campagne_id", "_abandon_autorise", "_reregler", "relances_auto"):
        nouveaux.pop(k, None)
    try:
        lancer(uid, "envoi", nouveaux)
    except ErreurTravail:
        return
    base.journal_noter(uid, "envoi", f"Boîte bloquée par la messagerie (blocage n° {nouveaux['blocages']}) : reprise automatique "
                                     f"{quand_fr(nouveaux['debut'])}, au rythme d'IESEG et SKEMA (1 mail de 90 étudiants par jour).",
                       "critique")


def lancer(uid, type_, params):
    """Démarre la recherche (« annuaire ») ou l'envoi en arrière-plan. Les deux peuvent
    tourner ensemble ; chacun une seule fois à la fois."""
    if en_cours(uid, type_):
        raise ErreurTravail("La recherche est déjà en cours." if type_ == "annuaire" else "Un envoi est déjà en cours.")
    t = Travail(uid, type_)
    t.params = params
    _travaux[(uid, type_)] = t
    _maj(uid, type_, "attente", params, {}, "En attente d'un navigateur libre…")
    coro = (_regrouper(t, params) if type_ == "annuaire" else _trier_tout(t, params) if type_ == "tri"
            else _envoyer(t, params))  # « envoi » ou « test »
    t.tache = asyncio.get_running_loop().create_task(_sans_origine(coro))
    return t


def arreter(uid, type_):
    t = en_cours(uid, type_)
    if not t:
        return False
    t.arret.set()
    return True


ECART_REPRISE = 40  # secondes entre deux reprises après un redémarrage (les tests la mettent à 0)


async def reprendre_apres_redemarrage():
    """Au démarrage du serveur : les travaux interrompus repartent, l'un après l'autre (charger
    plusieurs Outlook avec de grosses mémoires en même temps peut les geler)."""
    for i, (uid, type_) in enumerate(base.travaux_a_reprendre()):
        if i and ECART_REPRISE:
            await asyncio.sleep(ECART_REPRISE)
        t = base.travail_lire(uid, type_)
        if t and not en_cours(uid, type_) and t["statut"] in ("en_cours", "attente"):
            params = dict(t["params"])
            params["reprise"] = True
            params.pop("relances_auto", None)  # nouveau démarrage : de nouveau droit aux relances automatiques
            try:
                lancer(uid, type_, params)
            except ErreurTravail:
                pass


async def fermer_tout():
    """Arrêt du serveur : chaque travail range sa mémoire puis s'arrête. Ils restent
    « en cours » en base et repartiront au prochain démarrage."""
    taches = [t.tache for t in list(_travaux.values()) + list(_tests.values()) if t.tache and not t.tache.done()]
    for t in taches:
        t.cancel()
    if taches:
        await asyncio.wait(taches, timeout=30)
    _travaux.clear()
    _tests.clear()
    global _places
    _places = None


# ------------------------------------------------------------------ regrouper l'annuaire
def _echantillon(personnes):
    avec = [p for p in personnes if p.get("nom")]
    sans = [p for p in personnes if not p.get("nom")]
    return (avec[:22] + sans[:30 - min(22, len(avec))])[:30]


# Contacts que l'IA n'a pas pu trier (erreur, crédit épuisé, budget ou quota du mois) :
# ils ne sont JAMAIS exclus. Ils restent à trier et seront repris au prochain passage.
NON_TRIES = ("erreur", "budget", "quota")
# Pannes qui ne passeront pas toutes seules : la recherche se met en pause.
PANNES_DURABLES = ("crédit", "clé", "autorisation", "budget", "quota")
# Les contacts lus sont triés par tranches : la progression s'affiche en direct et une
# pause est prise en quelques secondes, même à la reprise de milliers de contacts.
TRANCHE = 300
MESSAGE_IA_INDISPONIBLE = ("Le tri automatique des contacts est indisponible pour le moment : la recherche est en pause. "
                           "Rien n'est perdu : les contacts déjà lus seront triés quand vous la relancerez.")


async def _regrouper(t, params):
    if _messagerie(t.uid) == "universel":
        from . import universel  # connexion universelle : annuaire Zimbra, sans navigateur
        await universel.regrouper(t, params)
        return
    uid, objectif = t.uid, int(params.get("objectif") or 500)
    # L'objectif compte les élèves trouvés pour cette liste (ceux déjà servis avant la
    # nouvelle recherche, gardés dans « Reçu », ne comptent pas).
    base_recus = int(params.get("base_recus") or 0)
    prog = {"objectif": objectif, "trouves": max(0, base.destinataires_compter(uid) - base_recus),
            "ecartes": base.exclus_compter(uid), "releves": 0, "deja_contactes": 0}
    vus = set()  # adresses (en minuscules) déjà traitées : jamais retriées
    # Extraction d'abord : tant que la logique de l'école n'a pas été apprise sur TOUT l'annuaire
    # (« Garder seulement les étudiants »), la recherche range les contacts sans rien trier ni
    # payer. Ensuite, les nouveaux contacts sont triés au fil de l'eau avec cette logique.
    globale = base.logique_lire(uid)
    tri_auto = globale is not None or not params.get("extraction")
    logique = globale or params.get("logique") or None
    logique_tentee = globale is not None
    echecs_ia = 0
    prog["extraits"] = base.extraits_compter(uid)
    pw = contexte = sw = dossier = None
    interrompu = False
    try:
        async with _place():
            await _attendre_memoire(uid, "annuaire", params, t)
            if t.arret.is_set():
                return
            _maj(uid, "annuaire", "en_cours", params, prog, "Ouverture d'Outlook…")
            pw, contexte, page, sw, dossier = await _ouvrir(uid)
            t.page = page
            # Ce qui est déjà dans la liste ou dans « Exclus » n'est jamais retrié en reprenant (après
            # un redémarrage, la mémoire de l'extension contient tout l'annuaire déjà lu).
            vus = base.adresses_triees(uid)
            gmail = _messagerie(uid) == "gmail"
            await (_aller_dans_gmail(page) if gmail else _aller_dans_outlook(page))
            _maj(uid, "annuaire", "en_cours", params, prog, "Ouverture de Gmail…" if gmail else "Ouverture d'Outlook…")
            await _attendre_outlook_pret(page, messagerie="gmail" if gmail else "outlook")
            ao = await _onglet(page, "adresses")
            # « Démarrer » : jusqu'à 4 essais, Outlook peut être lent à finir de s'afficher,
            # ou poser une fenêtre par-dessus (nouveautés, conseils) : Échap la ferme.
            for essai in range(4):
                if gmail:
                    await _redaction_gmail(page)
                champ = page.locator(GMAIL_A if gmail else 'input[aria-label="To"], input[aria-label="À"], [aria-label="À"][contenteditable], [aria-label="To"][contenteditable]').first
                try:
                    if await champ.count() and await champ.is_visible():
                        if gmail:
                            # Gmail : la fenêtre de rédaction s'ouvre sous le panneau Smart Mail ; un clic tomberait
                            # sur le panneau. On place le curseur dans « À » directement.
                            await champ.focus(timeout=5000)
                        else:
                            await champ.click(timeout=5000)
                    await ao.locator("#ao-run").click(timeout=10000)
                except PlaywrightTimeout:
                    await page.keyboard.press("Escape")
                    if essai == 3:
                        raise ErreurTravail(await _texte(ao.locator("#ao-notice")) or "Le relevé n'a pas démarré : relancez-le.")
                    await asyncio.sleep(3)
                    continue
                fin = time.monotonic() + 30
                while not await _patient(lambda: _actif(page, "adresses")) and time.monotonic() < fin:
                    await asyncio.sleep(0.5)
                if await _patient(lambda: _actif(page, "adresses")):
                    break
                if essai == 3:
                    raise ErreurTravail(await _texte(ao.locator("#ao-notice")) or "Le relevé n'a pas démarré.")
                await asyncio.sleep(5)
                await _attendre_outlook_pret(page, 20, "gmail" if gmail else "outlook")
            _maj(uid, "annuaire", "en_cours", params, prog, "Lecture de l'annuaire…")
            u = base.utilisateur_par_id(uid)
            sauvegarde = time.monotonic()
            arret_demande = fin_vue = False
            prochaine_reprise = 0.0
            gels = 0
            while True:
                if int(params.get("objectif") or objectif) != objectif:  # changé pendant la recherche
                    objectif = int(params["objectif"])
                    prog["objectif"] = objectif
                    fin_vue = False
                try:
                    actif = await _actif(page, "adresses")
                    gels = 0
                except PlaywrightTimeout:
                    gels += 1  # Outlook ne répond pas (page surchargée) : on attend, on ne s'arrête pas
                    print(f"[annuaire] compte {uid} : Outlook ne répond pas ({gels}/{GELS_MAX})", flush=True)
                    if gels >= GELS_MAX:
                        raise
                    await asyncio.sleep(10)
                    continue
                # Pause demandée ou objectif atteint : on arrête le relevé TOUT DE SUITE et
                # on ne trie plus rien (l'objectif est respecté à l'unité près).
                if not tri_auto and base.logique_lire(uid) is not None:  # « Garder seulement les étudiants » vient d'être fait
                    globale = base.logique_lire(uid)
                    tri_auto, logique, logique_tentee = True, globale, True
                if tri_auto and time.monotonic() >= prochaine_reprise and not en_cours(uid, "tri"):
                    # Contacts extraits sans tri plus tôt (pendant « Garder seulement les étudiants ») :
                    # la recherche les trie elle-même aux tranches suivantes. Personne n'est oublié.
                    prochaine_reprise = time.monotonic() + 60
                    restants = {x["adresse"] for x in base.extraits_lister(uid, 0, 200_000, non_tries=True)}
                    if restants:
                        vus.difference_update(restants)
                assez = tri_auto and prog["trouves"] >= objectif
                if (t.arret.is_set() or assez) and actif and not arret_demande:
                    await ao.locator("#ao-stop").click()
                    arret_demande = True
                if arret_demande:
                    _maj(uid, "annuaire", "en_cours", params, prog,
                         "Objectif atteint, arrêt de la recherche…" if assez else "Mise en pause…")
                presse = False  # des contacts lus attendent encore leur tri : pas de pause entre deux tranches
                if not (t.arret.is_set() or assez):
                    memoire = await sw.evaluate('() => chrome.storage.local.get(["mega-annuaire", "mega-noms"])')
                    noms = json.loads(memoire.get("mega-noms") or "{}") if memoire.get("mega-noms") else {}
                    noms_min = {k.lower(): v for k, v in noms.items()}
                    a_trier = [a for a in str(memoire.get("mega-annuaire") or "").split("\n") if a and a.lower() not in vus]
                    adresses, reste = a_trier[:TRANCHE], max(0, len(a_trier) - TRANCHE)
                    if adresses and not tri_auto:
                        # Extraction seule : tout est rangé, rien n'est trié (gratuit).
                        prog["extraits"] = base.extraits_ajouter(uid, [{"adresse": a, "nom": noms.get(a, "")} for a in adresses])
                        vus.update(a.lower() for a in adresses)
                        prog["releves"] = len(vus)
                        params.pop("relances_auto", None)  # ça avance : le compteur de relances repart à zéro
                        presse = reste > 0
                        _maj(uid, "annuaire", "en_cours", params, prog, f"Extraction de l'annuaire : {prog['extraits']} contacts…")
                    elif adresses:
                        personnes = [{"adresse": a, "nom": noms.get(a, "")} for a in adresses]
                        prog["extraits"] = base.extraits_ajouter(uid, personnes)
                        if not logique and not logique_tentee and len(vus) + len(personnes) >= 5:
                            # Une fois par passage (et de nouveau si elle avait échoué avant).
                            logique_tentee = True
                            lg, cout, err = await run_in_threadpool(logique_mod.apprenti().apprendre, _echantillon(personnes))
                            base.ajouter_usage(uid, cout_usd=cout)
                            logique = lg.model_dump() if lg else None
                            if logique:
                                params["logique"] = logique
                            elif err:
                                print(f"[annuaire] compte {uid} : logique de l'école non apprise ({err})", flush=True)
                        lg_obj = logique_mod.nettoyer(logique_mod.Logique(**logique)) if logique else None
                        reperes = _reperes_compte(uid, lg_obj if globale is not None else None)
                        r = await run_in_threadpool(service.trier, u, personnes, lg_obj, reperes)
                        non_tries = {x["adresse"].lower() for x in r["resultats"] if x["source"] in NON_TRIES}
                        eleves = [{"adresse": x["adresse"], "nom": noms_min.get(x["adresse"].lower(), ""), "source": x["source"]}
                                  for x in r["resultats"] if x["groupe"] == "etudiant"]
                        # Jamais quelqu'un qui a déjà reçu le message (de ce compte ou d'un autre).
                        eleves, contactes = base.destinataires_nouveaux(uid, eleves)
                        prog["deja_contactes"] += contactes
                        eleves = eleves[:max(0, objectif - prog["trouves"])]  # jamais plus que l'objectif
                        vus.update(a.lower() for a in adresses if a.lower() not in non_tries)  # les non triés seront repris
                        prog["releves"] = len(vus)
                        if eleves:
                            base.destinataires_ajouter(uid, eleves)
                            prog["trouves"] = max(0, base.destinataires_compter(uid) - base_recus)
                        # Les écartés, avec la raison (l'étudiant peut les voir et en ajouter) ; un
                        # contact reconnu élève cette fois sort de la liste des exclus.
                        base.exclus_retirer(uid, [x["adresse"] for x in r["resultats"] if x["groupe"] == "etudiant"])
                        base.destinataires_retirer_surs(uid, [x for x in r["resultats"] if x["groupe"] != "etudiant"
                                                              and (x["source"] == "regle" or x.get("garde"))])
                        base.exclus_noter(uid, [(x["adresse"], noms_min.get(x["adresse"].lower(), ""),
                                                 x["groupe"], x["type"], x["raison"], x["source"])
                                                for x in r["resultats"] if x["groupe"] != "etudiant" and x["source"] not in NON_TRIES])
                        prog["ecartes"] = base.exclus_compter(uid)
                        if r.get("budget_atteint"):
                            prog["budget_atteint"] = True
                        if non_tries:
                            echecs_ia += 1
                            raison = (r.get("erreurs") or [""])[0] or ("budget" if r.get("budget_atteint") else "quota")
                            print(f"[annuaire] compte {uid} : {len(non_tries)} contacts non triés ({raison})", flush=True)
                            if echecs_ia >= 3 or any(m in raison for m in PANNES_DURABLES):
                                # L'IA ne reviendra pas toute seule : pause propre, rien n'est exclu.
                                try:
                                    if await _actif(page, "adresses"):
                                        await ao.locator("#ao-stop").click(timeout=5000)
                                        await asyncio.sleep(2)
                                except Exception:
                                    pass
                                raise ErreurTravail(MESSAGE_IA_INDISPONIBLE)
                        else:
                            echecs_ia = 0
                        presse = reste > 0
                        _maj(uid, "annuaire", "en_cours", params, prog,
                             f"Tri des contacts déjà lus : {len(vus)} sur {len(vus) + reste}…" if presse else "Lecture de l'annuaire…")
                if not actif and not presse:
                    if fin_vue or arret_demande or t.arret.is_set() or prog["trouves"] >= objectif:
                        break
                    fin_vue = True  # encore un tour : l'extension range ses dernières trouvailles
                    await asyncio.sleep(1.5)
                    continue
                if time.monotonic() - sauvegarde > config.PAS_SAUVEGARDE:
                    await _ranger(uid, contexte, sw, "annuaire")
                    sauvegarde = time.monotonic()
                if presse:
                    continue  # tranche suivante tout de suite (la pause reste prise entre deux tranches)
                try:  # attente interrompue dès qu'on demande la pause
                    await asyncio.wait_for(t.arret.wait(), timeout=config.PAS_SUIVI)
                except asyncio.TimeoutError:
                    pass
            notice = await _texte(ao.locator("#ao-notice"))
            n = prog["trouves"]
            if not tri_auto:
                e = prog.get("extraits", 0)
                message = (f"Extraction en pause : {e} contacts extraits." if t.arret.is_set()
                           else f"Annuaire extrait : {e} contacts. Appuyez sur « Garder seulement les étudiants ».")
            elif n >= objectif:
                message = f"Objectif atteint : {n} élèves."
            elif t.arret.is_set():
                message = f"Recherche en pause : {n} élèves trouvés."
            elif "termin" in notice.lower() or not notice:
                message = f"Annuaire parcouru : {n} élèves."
            else:
                message = notice
            _maj(uid, "annuaire", "fini", params, prog, message)
    except asyncio.CancelledError:
        interrompu = True  # arrêt du serveur : reprendra au démarrage
        raise
    except ErreurTravail as e:
        _maj(uid, "annuaire", "erreur", params, prog, str(e))
    except Exception as e:
        print(f"[annuaire] compte {uid} : {type(e).__name__}: {navigateur.masquer(str(e))[:600]}", flush=True)
        await _diag(t, f"relevé : {type(e).__name__}")
        if isinstance(e, PlaywrightTimeout) and _relancer_plus_tard(uid, "annuaire", params, OUTLOOK_GELE):
            _maj(uid, "annuaire", "attente", params, prog, OUTLOOK_GELE)
        else:
            _maj(uid, "annuaire", "erreur", params, prog, "Le relevé s'est arrêté sur une erreur inattendue. Relancez-le.")
    finally:
        if contexte is not None:
            try:
                await asyncio.shield(asyncio.wait_for(_ranger(uid, contexte, sw, "annuaire"), timeout=60))  # jamais bloqué par un Outlook gelé
            except BaseException:
                pass
            await _fermer(pw, contexte, dossier)
        if not interrompu and _travaux.get((uid, "annuaire")) is t:
            _travaux.pop((uid, "annuaire"), None)


# ------------------------------------------------------------------ garder seulement les étudiants
TRANCHE_TRI = 500
PART_ETUDIANTS_MIN = 0.15  # une logique qui garde moins de 15 % d'étudiants est revue une fois par Claude


def _reperes_compte(uid, lg):
    """Les repères du tri : d'abord ceux de la logique de l'école (apprise sur tout l'annuaire, elle ne
    bascule pas si la liste contient beaucoup d'ajouts à la main), sinon les élèves déjà trouvés."""
    if lg:
        r = _reperes_logique(lg, base.destinataires_lister(uid, 0, 3000))
        if r:
            return r
    return base.reperes_eleves(uid)


def _reperes_logique(lg, contacts):
    """Avant le premier élève du compte : des exemples tirés de l'annuaire extrait, aux
    domaines et formats que la logique attribue aux étudiants."""
    if not lg:
        return {}
    formats = {d.domaine: set(d.formats_etudiant) for d in lg.domaines if d.formats_etudiant}
    reperes = {}
    for c in contacts:
        dom = c["adresse"].rsplit("@", 1)[-1]
        if dom in formats and len(reperes.get(dom, [])) < 5 and logique_mod.format_adresse(c["adresse"], c.get("nom") or "") in formats[dom]:
            reperes.setdefault(dom, []).append(c["adresse"])
    return reperes


async def _trier_tout(t, params):
    """« Garder seulement les étudiants » : une seule pression. La logique de l'école est apprise sur
    TOUT l'annuaire extrait (vérifiée si elle garde trop peu d'étudiants : ils sont normalement de loin
    les plus nombreux), puis appliquée à chacun, y compris aux contacts extraits pendant le tri ;
    Claude ne voit que les cas qu'elle ne tranche pas. Élèves → « À envoyer », les autres → « Exclus ».
    Rien de ce qui est déjà dans la liste n'est retiré."""
    uid = t.uid
    prog = {"total": 0, "tries": 0, "etudiants": base.destinataires_compter(uid, "a_envoyer"), "exclus": base.exclus_compter(uid)}
    interrompu = False
    try:
        _maj(uid, "tri", "en_cours", params, prog, "Étude de tout l'annuaire…")
        tous = base.extraits_lister(uid, 0, 10_000_000)
        if not tous:
            raise ErreurTravail("Rien à trier : lancez d'abord l'extraction de l'annuaire.")
        u = base.utilisateur_par_id(uid)
        existante = base.logique_lire(uid)
        lg = None
        if existante and int(existante.get("appris_sur") or 0) * 2 > len(tous):
            # Déjà apprise sur un annuaire comparable : on la garde (pas de nouvel appel, pas de coût).
            lg = logique_mod.nettoyer(logique_mod.Logique(**existante))
        else:
            apprenti = logique_mod.apprenti()
            lg, cout, err = await run_in_threadpool(apprenti.apprendre_global, tous)
            base.ajouter_usage(uid, cout_usd=cout)
            if lg:
                part = await run_in_threadpool(logique_mod.part_etudiants, lg, tous)
                if part < PART_ETUDIANTS_MIN:
                    # Trop peu d'étudiants pour un annuaire d'école : Claude revoit sa logique, une fois.
                    remarque = logique_mod.VERIFICATION.format(part=f"{part:.0%}", n=len(tous))
                    lg2, cout2, _ = await run_in_threadpool(apprenti.apprendre_global, tous, remarque)
                    base.ajouter_usage(uid, cout_usd=cout2)
                    if lg2:
                        part2 = await run_in_threadpool(logique_mod.part_etudiants, lg2, tous)
                        base.journal_noter(uid, "tri", f"Logique vérifiée une seconde fois : {part:.0%} puis {part2:.0%} d'étudiants "
                                                       f"dans l'annuaire extrait.", "attention" if part2 < PART_ETUDIANTS_MIN else "info")
                        lg = lg2
                base.logique_ecrire(uid, {**lg.model_dump(), "appris_sur": len(tous)})
            elif err and any(m in err for m in PANNES_DURABLES):
                raise ErreurTravail(MESSAGE_IA_INDISPONIBLE)
            else:
                lg = logique_mod.nettoyer(logique_mod.Logique(**existante)) if existante else None
        print(f"[tri] compte {uid} : logique apprise sur {len(tous)} contacts ({'oui' if lg else 'non'})", flush=True)
        echecs = 0

        async def trier_liste(a_trier):
            nonlocal echecs
            for k in range(0, len(a_trier), TRANCHE_TRI):
                if t.arret.is_set():
                    return
                tranche = a_trier[k:k + TRANCHE_TRI]
                reperes = _reperes_compte(uid, lg) or _reperes_logique(lg, tous)
                r = await run_in_threadpool(service.trier, u, tranche, lg, reperes)
                non_tries = {x["adresse"].lower() for x in r["resultats"] if x["source"] in NON_TRIES}
                noms = {c["adresse"]: c.get("nom", "") for c in tranche}
                eleves = [{"adresse": x["adresse"], "nom": noms.get(x["adresse"], ""), "source": x["source"]}
                          for x in r["resultats"] if x["groupe"] == "etudiant"]
                eleves, _ = base.destinataires_nouveaux(uid, eleves)
                if eleves:
                    base.destinataires_ajouter(uid, eleves)
                base.exclus_noter(uid, [(x["adresse"], noms.get(x["adresse"], ""), x["groupe"], x["type"], x["raison"], x["source"])
                                        for x in r["resultats"] if x["groupe"] != "etudiant" and x["source"] not in NON_TRIES])
                base.destinataires_retirer_surs(uid, [x for x in r["resultats"] if x["groupe"] != "etudiant" and x["source"] == "regle"])
                if non_tries:
                    echecs += 1
                    raison = (r.get("erreurs") or [""])[0] or ("budget" if r.get("budget_atteint") else "quota")
                    if echecs >= 3 or any(m in raison for m in PANNES_DURABLES):
                        raise ErreurTravail(MESSAGE_IA_INDISPONIBLE)
                prog["tries"] += len(tranche)
                prog.update(etudiants=base.destinataires_compter(uid, "a_envoyer"), exclus=base.exclus_compter(uid))
                _maj(uid, "tri", "en_cours", params, prog, f"Tri : {prog['tries']} sur {prog['total']}…")

        a_trier = base.extraits_lister(uid, 0, 10_000_000, non_tries=True)
        prog["total"] = len(a_trier)
        await trier_liste(a_trier)
        # Les contacts extraits pendant le tri : triés aussi, sans qu'il faille appuyer de nouveau
        # (si la recherche tourne, elle les trie elle-même avec cette logique).
        for _ in range(3):
            if t.arret.is_set() or en_cours(uid, "annuaire"):
                break
            reste = base.extraits_lister(uid, 0, 10_000_000, non_tries=True)
            if not reste:
                break
            prog["total"] += len(reste)
            await trier_liste(reste)
        if lg:
            prog["logique"] = lg.resume
        if t.arret.is_set():
            _maj(uid, "tri", "pause", params, prog, f"Tri en pause : {prog['etudiants']} élèves à qui envoyer.")
        else:
            _maj(uid, "tri", "fini", params, prog,
                 f"Terminé : {prog['etudiants']} élèves gardés, {prog['exclus']} exclus (voir la liste).")
    except asyncio.CancelledError:
        interrompu = True  # arrêt du serveur : reprendra au démarrage
        raise
    except ErreurTravail as e:
        _maj(uid, "tri", "erreur", params, prog, str(e))
    except Exception as e:
        print(f"[tri] compte {uid} : {type(e).__name__}: {navigateur.masquer(str(e))[:600]}", flush=True)
        _maj(uid, "tri", "erreur", params, prog, "Le tri s'est arrêté sur une erreur inattendue. Rien n'est perdu : relancez-le.")
    finally:
        if not interrompu and _travaux.get((uid, "tri")) is t:
            _travaux.pop((uid, "tri"), None)


# ------------------------------------------------------------------ envoyer
# ------------------------------------------------------------------ le message
# « {date} » devient la date limite, calculée au moment où l'envoi part : J+6 (lancé
# le 8, « before November 14 »). « {date_fr} » : la même en français.
# « [texte](https://…) » devient un lien cliquable ; une adresse https://… aussi.
import html as _html
import re as _re

JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"]
MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
DELAI_JOURS = 6


def _jour_limite(maintenant=None):
    return (maintenant or datetime.now(ZoneInfo(config.FUSEAU))).date() + timedelta(days=DELAI_JOURS)


# Langues du message : « {date} » s'écrit dans la langue choisie.
LANGUES = {
    "en": lambda d: f"{MONTHS[d.month - 1]} {d.day}",
    "fr": lambda d: f"{d.day} {MOIS[d.month - 1]}",
    "es": lambda d: f"{d.day} de {MESES[d.month - 1]}",
    "de": lambda d: f"{d.day}. {MONATE[d.month - 1]}",
    "it": lambda d: f"{d.day} {MESI[d.month - 1]}",
}


def date_limite(maintenant=None, langue="en"):
    d = _jour_limite(maintenant)
    return LANGUES.get(langue, LANGUES["en"])(d)


def date_limite_fr(maintenant=None):
    d = _jour_limite(maintenant)
    return f"{JOURS[d.weekday()]} {d.day} {MOIS[d.month - 1]}"


def personnaliser(texte, maintenant=None, langue="en"):
    return (texte or "").replace("{date_fr}", date_limite_fr(maintenant)).replace("{date}", date_limite(maintenant, langue))


_RE_URL = _re.compile(r"https?://[^\s)\]>\"']+")
_NAVIGATEUR = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) "
               "Version/17.0 Safari/605.1.15")


def lien_mort(texte):
    """Le premier lien du message qui ne répond pas (site éteint, domaine inexistant, page 404), ou ""."""
    import urllib.error
    import urllib.request
    for url in dict.fromkeys(u.rstrip(".,;:!?") for u in _RE_URL.findall(texte or "")):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": _NAVIGATEUR}), timeout=15) as r:
                if r.status >= 500:
                    return url
        except urllib.error.HTTPError as e:
            if e.code == 404 or e.code >= 500:
                return url
        except Exception:
            return url
    return ""


_LIEN_TEXTE = _re.compile(r"\[([^\]\n]{1,200})\]\((https?://[^\s)]{1,500})\)")
_LIEN_NU = _re.compile(r"(?<![\"'>=])(https?://[^\s<]{1,500}[^\s<.,;:!?)\]])")


def en_morceaux(texte):
    """Le message tapé par l'étudiant, découpé en lignes de morceaux {"t": texte, "h": lien} :
    « [texte](lien) » et les adresses https://… deviennent des liens cliquables. Le
    navigateur en fait des éléments un par un, sans jamais injecter de HTML (Outlook
    refuse innerHTML quand il n'a pas fini de démarrer)."""
    lignes = []
    for ligne in (texte or "").split("\n"):
        morceaux, fin = [], 0
        for m in _LIEN_TEXTE.finditer(ligne):
            morceaux += _nus(ligne[fin:m.start()])
            morceaux.append({"t": m.group(1), "h": m.group(2)})
            fin = m.end()
        morceaux += _nus(ligne[fin:])
        lignes.append([x for x in morceaux if x["t"]])
    return lignes


def _nus(texte):
    morceaux, fin = [], 0
    for m in _LIEN_NU.finditer(texte):
        morceaux.append({"t": texte[fin:m.start()]})
        morceaux.append({"t": m.group(1), "h": m.group(1)})
        fin = m.end()
    morceaux.append({"t": texte[fin:]})
    return morceaux


def en_html(texte):
    """Le même message en HTML (aperçu et contrôles)."""
    sortie = []
    for ligne in en_morceaux(texte):
        contenu = "".join(f'<a href="{_html.escape(x["h"], quote=True)}">{_html.escape(x["t"])}</a>' if x.get("h")
                          else _html.escape(x["t"]) for x in ligne)
        sortie.append(f"<div>{contenu}</div>" if contenu.strip() else "<div><br></div>")
    return "".join(sortie)


# Construit le message dans l'éditeur de l'extension avec des éléments, sans innerHTML.
_REMPLIR_TEXTE = """(e, lignes) => {
    while (e.firstChild) e.removeChild(e.firstChild);
    for (const ligne of lignes) {
        const div = document.createElement('div');
        if (!ligne.some(x => x.t.trim())) div.appendChild(document.createElement('br'));
        else for (const x of ligne) {
            if (x.h) { const a = document.createElement('a'); a.setAttribute('href', x.h); a.textContent = x.t; div.appendChild(a); }
            else div.appendChild(document.createTextNode(x.t));
        }
        e.appendChild(div);
    }
    e.dispatchEvent(new Event('input', {bubbles: true}));
}"""


SECONDES_PAR_MAIL = 25  # un mail d'un pack : écriture, envoi, et quelques secondes d'écart
SECONDES_CCI = 35  # en plus pour un mail à plusieurs centaines de destinataires en Cci
MINUTE = 60  # (les tests la raccourcissent)


def destinataires_par_mail(p):
    return max(1, int(p.get("destinataires") or 1)) if p.get("pack") else max(1, int(p.get("taille_pack") or 1))


def capacite_jour(p):
    """Destinataires servis en une journée avec ces packs, dans la plage horaire, jamais plus que
    « max_jour » (le plafond de la messagerie)."""
    pack = int(p.get("pack") or 0)
    if not pack:
        return int(p.get("max_jour") or 400)
    dpm = destinataires_par_mail(p)
    plage = max(1, int(p.get("heure_fin", 20)) - int(p.get("heure_debut", 8))) * 3600
    attente = int(p.get("attente") or 30) * 60
    par_mail = SECONDES_PAR_MAIL + (SECONDES_CCI if dpm > 1 else 0)
    packs = max(1, (plage + attente) // (pack * par_mail + attente))
    return int(max(1, min(int(p.get("max_jour") or 9995), packs * pack * dpm)))


def _heure(ts):
    return datetime.fromtimestamp(ts, ZoneInfo(config.FUSEAU)).strftime("%H h %M")


async def _regler_rythme(pp, p):
    """Reprise d'un envoi par packs : les réglages du moment (taille des packs, attente)
    s'appliquent aussi à la campagne de l'extension (écart entre deux mails, plafond
    sur 24 h). Jamais bloquant : en cas de souci, l'envoi reprend avec les anciens."""
    if not p.get("pack"):
        return
    try:
        champs = {"#pp-pmin": "12", "#pp-pmax": "25", "#pp-max": str(capacite_jour(p))}
        if not await pp.locator("#pp-max").is_visible():
            gear = pp.locator("#pp-gear")
            if await gear.is_visible() and await gear.is_enabled():
                await gear.click(timeout=5000)
        for sel, v in champs.items():
            loc = pp.locator(sel)
            if await loc.is_visible() and (await loc.input_value()) != v:
                await loc.fill(v)  # l'extension applique aussitôt le rythme à la campagne
        retour = pp.locator("#pp-retour")
        if await retour.is_visible():
            await retour.click(timeout=5000)
    except Exception as x:
        print(f"[envoi] réglages de la reprise non appliqués ({type(x).__name__})", flush=True)


async def _attendre_arret(page, delai=90):
    """Après « Pause » : l'extension finit le mail en cours ; on ne ferme pas avant."""
    fin = time.monotonic() + delai
    while time.monotonic() < fin and await _actif(page, "envoi"):
        await asyncio.sleep(1)


async def _pause(pp):
    """« Pause » de l'extension : arrêt après le mail en cours. Le bouton se grise dès le
    premier clic ; on ne reclique pas (sinon on attendrait qu'il revienne)."""
    b = pp.locator("#pp-pause")
    try:
        if await b.is_visible() and await b.is_enabled():
            await b.click(timeout=5000)
    except PlaywrightTimeout:
        pass


# Anti-saturation (15/11) : un envoi qui attend longtemps (pause entre deux packs, nuit) rend son
# navigateur et repart tout seul à l'heure ; et aucun navigateur ne s'ouvre quand la mémoire manque.
SOMMEIL_MIN = 15 * 60          # au-delà de 15 min d'attente, le navigateur est fermé
MEMOIRE_MIN_MO = {"envoi": 1200, "annuaire": 2500}   # les envois passent avant les extractions


def _memoire_dispo_mo():
    try:
        with open("/proc/meminfo") as fichier:
            for ligne in fichier:
                if ligne.startswith("MemAvailable:"):
                    return int(ligne.split()[1]) // 1024
    except Exception:
        pass
    return 1 << 30


async def _attendre_memoire(uid, type_, params, t=None):
    """Garde-fou : tant que le serveur manque de mémoire, le travail attend au lieu de tout geler."""
    seuil, prevenu = MEMOIRE_MIN_MO.get(type_, 1500), False
    while _memoire_dispo_mo() < seuil and not (t and t.arret.is_set()):
        if not prevenu:
            print(f"[{type_}] compte {uid} : mémoire basse ({_memoire_dispo_mo()} Mo), on attend avant d'ouvrir un navigateur", flush=True)
            _maj(uid, type_, "attente", params, {}, "En attente : le serveur manque de mémoire, le travail démarre dès qu'elle se libère…")
            prevenu = True
        await asyncio.sleep(20)


def _prochaine_plage(p):
    """Heure (epoch) du prochain début de plage d'envoi."""
    z = ZoneInfo(config.FUSEAU)
    maintenant = datetime.now(z)
    debut = maintenant.replace(hour=int(p.get("heure_debut", 8)) % 24, minute=0, second=0, microsecond=0)
    if debut <= maintenant:
        debut += timedelta(days=1)
    return debut.timestamp()


def _dormir(uid, params, reveil):
    """Rend le navigateur pendant une longue attente : l'envoi est reprogrammé à « reveil » et repart
    tout seul, là où il en était (comme après un redémarrage du serveur)."""
    p2 = dict(params)
    p2["debut"], p2["reprise"], p2["sommeil"] = reveil, True, True
    p2["_prog_sommeil"] = dict((base.travail_lire(uid, "envoi") or {}).get("progression") or {})  # compteurs gardés à l'écran
    p2.pop("relances_auto", None)
    p2.pop("_abandon_autorise", None)
    try:
        lancer(uid, "envoi", p2)
    except ErreurTravail:
        pass


def _dans_la_plage(p):
    h = datetime.now(ZoneInfo(config.FUSEAU)).hour
    return p.get("heure_debut", 8) <= h < p.get("heure_fin", 20)


def _compter(campagne):
    c = {"envoyes": 0, "a_verifier": 0, "deja": 0, "echecs": 0, "total": 0, "curseur": 0}
    if not campagne:
        return c
    c["total"], c["curseur"] = campagne.get("total") or 0, campagne.get("curseur") or 0
    for r in (campagne.get("resultats") or {}).values():
        s = (r or {}).get("s")
        if s == "envoye":
            c["envoyes"] += 1
        elif s == "verifier":
            c["a_verifier"] += 1
        elif s == "deja":
            c["deja"] += 1  # déjà reçu lors d'un envoi précédent : servi, pas renvoyé
        elif s not in ("attente", "envoi"):
            c["echecs"] += 1
    return c


_STATUTS_SUIVIS = {"envoye", "deja", "envoi", "verifier"}


def _lot(p):
    """Combien d'élèves mettre dans le panneau à la fois : un pack (2 × 495 au plus), jamais plus
    que la journée. Au-delà de ~2 000 adresses, le panneau de l'extension se bloque (13/11)."""
    lot = capacite_jour(p)
    if p.get("pack"):
        lot = min(lot, int(p.get("pack") or 1) * destinataires_par_mail(p))
    return max(1, min(lot, 1000))


_RE_PROMO = _re.compile(r"\.(\d{2})$")


_PRIORITAIRES = {"mtime": None, "adresses": frozenset()}
FICHIER_PRIORITAIRES = "/data/prioritaires.txt"  # étudiants confirmés (Vérif LinkedIn, 16/11) : envoyés en premier


def _prioritaires():
    try:
        m = os.path.getmtime(FICHIER_PRIORITAIRES)
    except OSError:
        return frozenset()
    if m != _PRIORITAIRES["mtime"]:
        with open(FICHIER_PRIORITAIRES) as fichier:
            _PRIORITAIRES["adresses"] = frozenset(x.strip().lower() for x in fichier if x.strip())
        _PRIORITAIRES["mtime"] = m
    return _PRIORITAIRES["adresses"]


def _ordre_envoi(adresse, prioritaires=frozenset()):
    local, _, domaine = adresse.lower().partition("@")
    m = _RE_PROMO.search(local)
    etudiant = 0 if base._RE_SOUS_DOMAINE_ETUDIANT.match(domaine) else 1  # mail.mcgill.ca avant mcgill.ca
    return (0 if adresse.lower() in prioritaires else 1, etudiant, -int(m.group(1)) if m else 0, local)


def _choisir_eleves(uid, limite=None):
    """Les élèves à qui envoyer maintenant : trouvés, pas encore servis, réservés pour ce
    compte. Ceux qu'un autre ambassadeur a déjà servis passent dans « Reçu » sans recevoir
    un second message."""
    # La promo la plus récente d'abord quand l'adresse se termine par l'année (prénom.nom.26 :
    # Neoma, 13/11), puis l'ordre alphabétique (prénom puis nom : l'ordre des adresses prénom.nom).
    prio = _prioritaires()
    adresses = sorted((d["adresse"] for d in base.destinataires_lister(uid, 0, 1000000, "a_envoyer")),
                      key=lambda a: _ordre_envoi(a, prio))
    # Déjà contactés par l'ambassadeur lui-même, jusqu'à une adresse donnée (incluse) : jamais renvoyés.
    borne = str((base.parametres_lire(uid) or {}).get("deja_jusqua") or "").lower()
    if borne:
        deja = [a for a in adresses if a.split("@")[0].lower() <= borne]
        if deja:
            base.destinataires_statuer(uid, {a: "deja" for a in deja})
            base.marquer_recus(uid, deja)
            adresses = [a for a in adresses if a.split("@")[0].lower() > borne]
    if limite:
        # Seulement ce qui peut partir aujourd'hui : une liste de dizaines de milliers d'adresses
        # bloque le panneau de l'extension (13/11). Les suivants viennent à la campagne suivante.
        adresses = adresses[:max(1, int(limite))]
    if not adresses:
        return []
    pris = base.reserver(uid, adresses)
    if pris:
        base.destinataires_statuer(uid, {a: "pris" for a in pris})
        adresses = [a for a in adresses if a.lower() not in pris]
    return adresses


CUMULS = ("envoyes", "a_verifier", "deja", "echecs", "total", "curseur")


_JS_SAUTER = """([sauter, retablir]) => chrome.storage.local.get("pp-deja").then(o => {
    const deja = new Set((o["pp-deja"] || []).map(x => String(x).toLowerCase()));
    sauter.forEach(a => deja.add(a)); retablir.forEach(a => deja.delete(a));
    return chrome.storage.local.set({"pp-deja": Array.from(deja)}); })"""


async def _appliquer_sauts(uid, sw):
    """Les élèves retirés à la main sont sautés par la campagne ; ceux rajoutés depuis ne le sont plus."""
    sauter, retablir = base.sauts_lire(uid)
    if sauter or retablir:
        await sw.evaluate(_JS_SAUTER, [sorted(sauter), sorted(retablir)])
        base.sauts_effacer_retablis(uid, retablir)


async def sauter_dans_l_envoi(uid):
    """Un envoi tourne : l'extension relit « Déjà envoyés » avant chaque mail, on l'y met tout de suite."""
    t = en_cours(uid, "envoi")
    if t and getattr(t, "sw", None) is not None:
        try:
            await _appliquer_sauts(uid, t.sw)
        except Exception as x:
            print(f"[envoi] compte {uid} : retrait non transmis à l'envoi en cours ({type(x).__name__})", flush=True)


async def _suivre_eleves(uid, sw, c, suivi):
    """Coche dans la liste de l'étudiant, au fil de l'eau, ceux qui ont reçu le message
    (résultats de la campagne de l'extension, rangés par position dans sa liste)."""
    try:
        if suivi["id"] != c.get("id"):
            suivi["id"], suivi["vus"] = c.get("id"), {}
            suivi["liste"] = await sw.evaluate('() => chrome.storage.local.get("pp-liste").then(o => o["pp-liste"] || [])')
            suivi.setdefault("toutes", set()).update(a.lower() for a in suivi["liste"])  # pour les avis « non distribué »
        liste, changes = suivi["liste"], {}
        for k, r in (c.get("resultats") or {}).items():
            s = (r or {}).get("s")
            s = s if s in _STATUTS_SUIVIS else "" if s == "attente" else "echec"
            i = int(k)
            if suivi["vus"].get(i) != s and 0 <= i < len(liste):
                changes[liste[i]] = s
                suivi["vus"][i] = s
        if changes:
            base.destinataires_statuer(uid, changes)
            servis = [a for a, x in changes.items() if x in ("envoye", "verifier", "deja")]
            # Un élève retiré à la main et sauté (« deja ») n'a rien reçu : il ne compte pas comme servi.
            presents = base.destinataires_presents(uid, servis) if servis else set()
            servis = [a for a in servis if a.lower() in presents or changes[a] != "deja"]
            if servis:
                base.marquer_recus(uid, servis)  # plus jamais collectés ni envoyés, par personne
    except Exception as e:  # le suivi ne doit jamais arrêter l'envoi
        print(f"[envoi] compte {uid} : suivi des élèves : {type(e).__name__}", flush=True)


async def _assistant_collage(page, contexte):
    """Gmail (nouvelle présentation, 13/11) ignore les frappes simulées par l'extension. Quand elle le
    demande (data-pp-coller sur la page), on colle la liste dans le champ marqué avec un vrai Ctrl+V,
    que Gmail transforme en pastilles. L'extension vérifie ensuite chaque adresse."""
    deja = None
    try:
        await contexte.grant_permissions(["clipboard-read", "clipboard-write"], origin="https://mail.google.com")
    except Exception:
        pass
    while not page.is_closed():
        try:
            j = await page.evaluate("() => document.documentElement.getAttribute('data-pp-coller')")
            if j and j != deja:
                texte = await page.evaluate("() => document.documentElement.getAttribute('data-pp-texte') || ''")
                await page.locator(f'[data-pp-cible="{j}"]').evaluate("e => e.focus()")
                await page.evaluate("t => navigator.clipboard.writeText(t)", texte)
                await page.keyboard.press("Control+V")
                deja = j
                await page.evaluate("j => document.documentElement.setAttribute('data-pp-colle', j)", j)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            if page.is_closed():
                return
            print(f"[gmail] collage : {type(e).__name__}", flush=True)
        await asyncio.sleep(0.4)


async def _campagne(sw):
    m = await sw.evaluate('() => chrome.storage.local.get("pp-campagne")')
    return m.get("pp-campagne")


async def _preparer(page, pp, adresses, objet, texte, p, langue="en"):
    """Remplit le panneau d'envoi. Vérifie que le compte d'adresses affiché par
    l'extension n'est JAMAIS supérieur à la liste voulue."""
    # Revenir à la préparation (après un réglage ou un envoi terminé).
    if not await pp.locator("#pp-dest").is_visible():
        retour = pp.locator("#pp-retour")
        if await retour.count() and await retour.is_visible():
            await retour.click()
        await pp.locator("#pp-dest").wait_for(state="visible", timeout=10000)
    case = pp.locator("#pp-annuaire-actif")
    if await case.count() and await case.is_visible() and await case.is_checked():
        await case.uncheck()  # pas l'annuaire brut : seulement les élèves triés
    await pp.locator("#pp-dest").fill("\n".join(adresses))
    await pp.locator("#pp-objet").fill(personnaliser(objet, langue=langue))
    # Le message en HTML (liens cliquables) dans l'éditeur de l'extension, comme si on
    # l'avait collé : elle le nettoie elle-même (DOMPurify) avant de l'envoyer.
    await pp.locator("#pp-texte").evaluate(_REMPLIR_TEXTE, en_morceaux(personnaliser(texte, langue=langue)))
    # Toujours en importance élevée.
    importance = pp.locator("#pp-importance")
    if await importance.count() and await importance.is_visible() and not await importance.is_checked():
        await importance.check()
    if p.get("pack"):
        # Par packs : quelques secondes entre deux mails d'un pack ; la pause entre les
        # packs, c'est le serveur qui la fait.
        reglages = {"#pp-pmin": "12", "#pp-pmax": "25", "#pp-max": str(capacite_jour(p))}
        paquet = destinataires_par_mail(p)  # jusqu'à 495 élèves par mail, en Cci
    else:
        pause = 3600.0 / max(1, int(p.get("packs_heure", 35)))
        reglages = {"#pp-pmin": str(max(1, round(pause * 0.8))), "#pp-pmax": str(max(1, round(pause * 1.2))),
                    "#pp-max": str(int(p.get("max_jour", 400)))}
        paquet = int(p.get("taille_pack", 1))
    if paquet > 1:
        reglages["#pp-paquet"] = str(paquet)
    for sel in list(reglages) + ["#pp-cci"]:
        if not await pp.locator(sel).is_visible():
            gear = pp.locator("#pp-gear")
            if await gear.count() and await gear.is_visible():
                await gear.click()
            break
    cci = pp.locator("#pp-cci")
    if paquet > 1 and not await cci.is_checked():
        await cci.check()
    elif paquet == 1 and await cci.count() and await cci.is_checked():
        await cci.uncheck()  # un mail par élève
    for sel, v in reglages.items():
        await pp.locator(sel).fill(v)
    # Les réglages sont sur un autre volet : retour à la préparation pour le compte et « Envoyer ».
    if not await pp.locator("#pp-nb").is_visible():
        retour = pp.locator("#pp-retour")
        if await retour.count() and await retour.is_visible():
            await retour.click()
    # Le panneau recompte la liste après la saisie : on attend son chiffre.
    chiffres, fin = 0, time.monotonic() + 8
    while time.monotonic() < fin:
        nb = await _texte(pp.locator("#pp-nb"))
        chiffres = int("".join(ch for ch in nb if ch.isdigit()) or "0")
        if chiffres:
            break
        await asyncio.sleep(0.3)
    if chiffres > len(adresses):
        raise ErreurTravail("La liste d'envoi ne correspond pas aux élèves : envoi annulé, rien n'est parti.")
    return chiffres


async def _envoyer(t, params):
    """Envoi aux élèves (type « envoi »), ou message test à soi-même (type « test »)."""
    uid, type_ = t.uid, t.type
    test = type_ == "test"
    prog = {}
    pw = contexte = sw = dossier = None
    interrompu = False
    reprise_blocage = False  # boîte bloquée : reprise automatique dans 24 h, à 90 par jour
    sommeil = None  # longue attente : heure de reprise (le navigateur est rendu d'ici là)
    try:
        if not test and float(params.get("debut") or 0) > time.time():
            # Envoi programmé : on attend l'heure choisie sans occuper de navigateur. Un redémarrage
            # du serveur reprend l'attente ; « Mettre en pause » annule, rien n'est parti.
            t.debut = float(params["debut"])
            if params.get("sommeil"):
                prog = dict(params.get("_prog_sommeil") or {})
                prog["programme"] = t.debut

                def annonce():
                    return f"Pack terminé. Prochain pack à {_heure(t.debut)} (navigateur libéré en attendant)."
            else:
                prog = {"programme": t.debut, "total": base.destinataires_compter(uid, "a_envoyer")}

                def annonce():
                    return "Envoi programmé : il commencera " + quand_fr(t.debut) + "."
            _maj(uid, type_, "attente", params, prog, annonce())
            vu = t.debut
            while not t.arret.is_set() and t.debut > time.time():
                if t.debut != vu:  # heure changée pendant l'attente
                    vu = t.debut
                    prog["programme"] = t.debut
                    _maj(uid, type_, "attente", params, prog, annonce())
                try:
                    await asyncio.wait_for(t.arret.wait(), timeout=min(2.0, max(0.05, t.debut - time.time())))
                except asyncio.TimeoutError:
                    pass
            params.pop("debut", None)
            params.pop("sommeil", None)
            params.pop("_prog_sommeil", None)
            t.debut = None
            if t.arret.is_set():
                _maj(uid, type_, "pause", params, {}, "Programmation annulée : rien n'est parti. Relancez l'envoi quand vous voulez.")
                return
            prog = {}
        if not test and config.VERIFIER_LIENS:
            # Jamais des centaines de mails avec un lien mort (site pas encore en ligne, domaine mal écrit).
            mort = await run_in_threadpool(lien_mort, params.get("texte") or "")
            if mort:
                _maj(uid, type_, "pause", params, prog, f"Envoi en pause avant d'envoyer : le lien {mort} ne répond pas. "
                                                         "Vérifiez que le site est en ligne, puis reprenez l'envoi.")
                return
        if not test and not base.outlook_lire(uid):
            # Pas de session (jamais connecté, ou Microsoft/Google l'a fermée) : l'envoi ATTEND la
            # reconnexion de l'ambassadeur, puis part tout seul, au rythme prévu. Personne n'a rien à relancer.
            _maj(uid, type_, "attente", params, prog, "En attente de la reconnexion de l'ambassadeur : l'envoi partira "
                                                      "tout seul dès qu'il se sera reconnecté.")
            base.journal_noter(uid, "session", "Heure d'envoi atteinte sans session de messagerie : l'envoi attend la "
                                               "reconnexion de l'ambassadeur, puis partira tout seul.", "critique")
            while not base.outlook_lire(uid) and not t.arret.is_set():
                try:
                    await asyncio.wait_for(t.arret.wait(), timeout=60)
                except asyncio.TimeoutError:
                    pass
            if t.arret.is_set():
                _maj(uid, type_, "pause", params, prog, "Envoi en pause.")
                return
            base.journal_noter(uid, "session", "Ambassadeur reconnecté : l'envoi reprend tout seul.")
        if _messagerie(uid) == "universel":
            from . import universel  # connexion universelle : envoi par SMTP, sans navigateur
            await universel.envoyer_travail(t, params)
            return
        async with _place():
            if not test:
                await _attendre_memoire(uid, type_, params, t)
                if t.arret.is_set():
                    _maj(uid, type_, "pause", params, prog, "Envoi en pause.")
                    return
            _maj(uid, type_, "en_cours", params, prog, "Ouverture d'Outlook…")
            pw, contexte, page, sw, dossier = await _ouvrir(uid)
            t.page, t.sw = page, sw
            moi = (base.utilisateur_par_id(uid) or {}).get("email") or ""
            if not test:
                await _appliquer_sauts(uid, sw)  # retirés à la main : sautés ; rajoutés : plus sautés
            # La recherche tourne peut-être en même temps, dans SON navigateur : sa trace
            # « relevé en cours » (protection entre onglets d'un même navigateur) ne
            # concerne pas celui-ci.
            await sw.evaluate('() => chrome.storage.local.remove(["actif-outlook", "actif-gmail"])')
            if test:
                # Copie de travail du test : la limite du jour et le verrou de l'envoi en
                # cours ne le concernent pas (il ne part qu'à soi, et rien n'est rangé).
                await sw.evaluate('() => chrome.storage.local.remove(["pp-envois", "pp-actif", "pp-pack"])')

            def confirmer(d):
                # Seule confirmation acceptée : abandonner une ANCIENNE campagne avant d'en lancer une nouvelle.
                ok = d.message.startswith("Abandonner cet envoi") and params.get("_abandon_autorise")
                asyncio.ensure_future(d.accept() if ok else d.dismiss())
            page.on("dialog", confirmer)

            gmail = _messagerie(uid) == "gmail"
            if gmail:
                t.collage = asyncio.get_running_loop().create_task(_assistant_collage(page, contexte))
            await (_aller_dans_gmail(page, "envoi") if gmail else _aller_dans_outlook(page))
            await _attendre_outlook_pret(page, messagerie="gmail" if gmail else "outlook")
            pp = await _onglet(page, "envoi")
            p = params.get("parametres") or {}
            c = await _campagne(sw)
            # Notre campagne : celle notée au lancement ; ou, après un redémarrage, la campagne
            # inachevée laissée dans la mémoire de l'extension (seul le serveur la pilote).
            mienne = bool(c and ((params.get("campagne_id") and c.get("id") == params["campagne_id"])
                                 or (params.get("reprise") and not params.get("campagne_id")
                                     and (c.get("curseur") or 0) < (c.get("total") or 0))))
            if mienne and not params.get("campagne_id"):
                params["campagne_id"] = c.get("id")
            ancien_id = None if mienne else (c.get("id") if c else None)
            if not mienne:
                # Une ancienne campagne (finie ou non) occupe le panneau : « Nouvel envoi ».
                if c and await pp.locator("#pp-abandon").is_visible():
                    params["_abandon_autorise"] = True
                    await pp.locator("#pp-abandon").click()
                    await asyncio.sleep(1)
                    params.pop("_abandon_autorise", None)
                if test:
                    adresses = [moi]
                    if not moi:
                        raise ErreurTravail("Adresse du compte inconnue : reconnectez-vous.")
                    # Un test à soi-même ne doit pas bloquer les tests suivants : on retire sa
                    # propre adresse de « Déjà envoyés » (ce n'est pas un élève), APRÈS
                    # « Nouvel envoi » qui l'y range, puis l'extension relit sa liste.
                    deja = await sw.evaluate('() => chrome.storage.local.get("pp-deja").then(o => o["pp-deja"] || [])')
                    if any(str(x).lower() == moi.lower() for x in deja):
                        await sw.evaluate("""a => chrome.storage.local.get("pp-deja").then(o => chrome.storage.local.set(
                            {"pp-deja": (o["pp-deja"] || []).filter(x => String(x).toLowerCase() !== a)}))""", moi.lower())
                        await page.reload(wait_until="domcontentloaded")
                        await page.locator('html[data-mega-pret="1"]').wait_for(state="attached", timeout=60000)
                        pp = await _onglet(page, "envoi")
                else:
                    adresses = _choisir_eleves(uid, _lot(p))
                    if not adresses:
                        raise ErreurTravail("Aucun élève à qui envoyer : collectez d'autres élèves.")
                n = await _preparer(page, pp, adresses, params["objet"], params["texte"], p, params.get("langue", "en"))
                if n == 0:
                    if not test:
                        base.destinataires_statuer(uid, {a: "deja" for a in adresses})
                    raise ErreurTravail("Tous ces élèves ont déjà reçu un message : rien à envoyer.")
            if mienne and not test:
                await _regler_rythme(pp, p)
            go = pp.locator("#pp-go")
            # Les avis « non distribué » : lus dans un onglet à part, jamais pour un test.
            boite, lecture_boite = (None, 0.0) if test else (rebonds.Boite(contexte, "gmail" if gmail else "outlook"), 0.0)
            if boite:
                try:
                    await boite.ouvrir()
                    await page.bring_to_front()
                except Exception as x:
                    print(f"[envoi] compte {uid} : boîte de réception illisible ({type(x).__name__})", flush=True)
                lecture_boite = time.monotonic()
            non_distribues = set(params.get("non_distribues") or [])
            sauvegarde = time.monotonic()
            pause_par_nous = False
            relances_sans_progres, dernier_curseur, prochaine_relance = 0, -1, 0.0
            gels = 0
            demarre = False
            suivi = {"id": None, "liste": [], "vus": {}}
            while True:
                try:
                    actif = await _actif(page, "envoi")
                    gels = 0
                except PlaywrightTimeout:
                    gels += 1  # Outlook ne répond pas : on attend (le mail en cours finit de partir de lui-même)
                    print(f"[envoi] compte {uid} : Outlook ne répond pas ({gels}/{GELS_MAX})", flush=True)
                    if gels >= GELS_MAX:
                        raise
                    await asyncio.sleep(10)
                    continue
                c = await _campagne(sw)
                if c and ancien_id is not None and c.get("id") == ancien_id:
                    c = None  # l'ancienne campagne, pas encore la nôtre
                if c and not params.get("campagne_id"):
                    params["campagne_id"] = c.get("id")
                prog = _compter(c)
                if not test:
                    # Envoi continu : les campagnes déjà finies de cet envoi comptent aussi.
                    for k, v in (params.get("cumul") or {}).items():
                        prog[k] = prog.get(k, 0) + int(v or 0)
                if not test and c:
                    await _suivre_eleves(uid, sw, c, suivi)
                if params.pop("_reregler", False) and mienne and not test:
                    await _regler_rythme(pp, p)  # rythme changé depuis la console : appliqué tout de suite
                # Packs : « pack » mails, puis « attente » minutes de pause (jamais pour un test).
                pack = 0 if test else int(p.get("pack") or 0)
                servis = prog["envoyes"] + prog["a_verifier"] + prog["echecs"]
                dans_pack = attente_pack = 0
                if pack:
                    params.setdefault("pack_debut", servis)
                    # Un pack se compte en mails : un mail en Cci sert jusqu'à « destinataires » élèves.
                    dpm = destinataires_par_mail(p)
                    dans_pack = -(-max(0, servis - params["pack_debut"]) // dpm)
                    # L'extension s'arrête d'elle-même après le pack : la pause commence.
                    if (not actif and demarre and dans_pack >= pack and not params.get("reprise_a")
                            and prog["curseur"] < prog["total"]):
                        params["reprise_a"] = time.time() + int(p.get("attente") or 30) * MINUTE
                        prochaine_relance = 0.0
                    attente_pack = float(params.get("reprise_a") or 0) > time.time()
                    prog["pack"] = {"taille": pack, "attente": int(p.get("attente") or 30), "dans_pack": min(dans_pack, pack),
                                    "prochain": params.get("reprise_a") if attente_pack else None}
                notice = await _texte(pp.locator("#pp-notice"))
                blocage = ""
                if boite and time.monotonic() - lecture_boite >= config.PAS_BOITE:
                    lecture_boite = time.monotonic()
                    liste = sorted(suivi.get("toutes") or []) or (suivi.get("liste") or [])
                    for genre, eleves in await boite.nouveaux(liste):
                        if genre == "eleve":
                            # Un élève n'a pas reçu : noté, l'envoi continue.
                            non_distribues.update(eleves)
                            base.destinataires_statuer(uid, {a: "nondistribue" for a in eleves})
                        else:
                            blocage = genre
                    params["non_distribues"] = sorted(non_distribues)
                    if non_distribues:
                        print(f"[envoi] compte {uid} : {len(non_distribues)} non distribué(s)", flush=True)
                if non_distribues:
                    prog["non_distribues"] = len(non_distribues)
                if blocage:
                    # La boîte est bloquée pour l'envoi (ou avis inconnu) : pause tout de suite.
                    print(f"[envoi] compte {uid} : avis « non distribué » ({blocage}) : pause", flush=True)
                    if actif:
                        await _pause(pp)
                        await _attendre_arret(page)
                        prog = _compter(await _campagne(sw))
                        if non_distribues:
                            prog["non_distribues"] = len(non_distribues)
                    prog["blocage"] = True
                    reprise_blocage = blocage == "blocage" and not test
                    _maj(uid, type_, "pause", params, prog,
                         "Envoi mis en pause : Microsoft a bloqué votre adresse pour l'envoi (« Undeliverable », expéditeur non reconnu, "
                         "code 5.1.8 : soupçon de spam ou limite atteinte). Tout mail envoyé maintenant serait refusé et prolongerait le "
                         "blocage. Attendez qu'il soit levé (souvent 24 h, sinon par le service informatique de l'école), puis reprenez l'envoi."
                         if blocage == "blocage" else
                         "Envoi mis en pause par prudence : Outlook a renvoyé un « non distribué » que Smart Mail ne sait pas classer. "
                         "Regardez-le dans votre boîte de réception, puis reprenez l'envoi.")
                    break
                fini = c and prog["curseur"] >= prog["total"] > 0 and not actif
                if fini and not test:
                    # Envoi continu : des élèves trouvés depuis le lancement ? Ils partent à leur
                    # tour (une seule fois chacun, au même rythme). La recherche tourne encore ?
                    # On attend les suivants. Sinon, c'est fini.
                    if t.arret.is_set():
                        _maj(uid, type_, "pause", params, prog, "Envoi en pause.")
                        break
                    suivants = _choisir_eleves(uid, _lot(p))
                    if suivants:
                        if pack and dans_pack > 0 and not params.get("reprise_a"):
                            # La campagne a fini au milieu d'un pack : la pause d'abord.
                            params["reprise_a"] = time.time() + int(p.get("attente") or 30) * MINUTE
                        params["_abandon_autorise"] = True
                        try:
                            if await pp.locator("#pp-abandon").is_visible():
                                await pp.locator("#pp-abandon").click(timeout=10000)
                                await asyncio.sleep(1)
                        finally:
                            params.pop("_abandon_autorise", None)
                        n = await _preparer(page, pp, suivants, params["objet"], params["texte"], p, params.get("langue", "en"))
                        if n == 0:
                            base.destinataires_statuer(uid, {a: "deja" for a in suivants})  # déjà servis par ce compte
                            continue
                        params["cumul"] = {k: prog.get(k, 0) for k in CUMULS}
                        ancien_id, params["campagne_id"] = c.get("id"), None
                        params["pack_debut"] = prog["envoyes"] + prog["a_verifier"] + prog["echecs"]
                        prochaine_relance, relances_sans_progres, dernier_curseur = 0.0, 0, -1
                        print(f"[envoi] compte {uid} : l'envoi continue avec {n} nouveaux élèves", flush=True)
                        _maj(uid, type_, "en_cours", params, prog, f"{n} nouveaux élèves trouvés par la recherche : l'envoi continue avec eux.")
                        continue
                    if en_cours(uid, "annuaire"):
                        _maj(uid, type_, "en_cours", params, prog,
                             "Tous les élèves trouvés ont reçu le message. La recherche continue : l'envoi reprendra dès qu'elle en trouve d'autres.")
                        await asyncio.sleep(config.PAS_SUIVI)
                        continue
                    _maj(uid, type_, "fini", params, prog, f"Terminé : {prog['envoyes']} élèves ont reçu le message.")
                    break
                if fini:
                    msg = (f"Message test envoyé à {moi}. Regardez votre boîte de réception." if prog["envoyes"]
                           else notice or "Le message test n'a pas pu partir.")
                    _maj(uid, type_, "fini", params, prog, msg)
                    break
                if t.arret.is_set():
                    if actif:
                        await _pause(pp)
                        await _attendre_arret(page)
                        prog = _compter(await _campagne(sw))
                    _maj(uid, type_, "pause", params, prog, "Envoi en pause.")
                    break
                dans_plage = _dans_la_plage(p)
                if pack and actif and dans_pack > pack:
                    await _pause(pp)  # filet : jamais plus d'un pack d'affilée
                if actif and not dans_plage:
                    await _pause(pp)
                    pause_par_nous = True
                elif not actif and dans_plage and time.monotonic() >= prochaine_relance and not attente_pack:
                    limite = "Limite de" in notice  # limite sur 24 h : on attend, ce n'est pas une panne
                    if limite or prog["curseur"] != dernier_curseur:
                        relances_sans_progres, dernier_curseur = 0, prog["curseur"]
                    else:
                        relances_sans_progres += 1
                    if relances_sans_progres > 6:
                        raise ErreurTravail(notice or "L'envoi n'avance plus. Ouvrez Outlook pour vérifier, puis relancez.")
                    if await go.is_visible() and await go.is_enabled():
                        if pack:
                            # Un nouveau pack commence : l'extension s'arrêtera d'elle-même après « pack » mails.
                            await sw.evaluate('n => chrome.storage.local.set({"pp-pack": n})', pack)
                            params["pack_debut"] = servis
                            params.pop("reprise_a", None)
                            dans_pack = 0
                        else:
                            await sw.evaluate('() => chrome.storage.local.remove("pp-pack")')
                        await go.click()
                        demarre = True
                        # On note la campagne tout de suite : un arrêt du serveur juste après
                        # le clic doit la reprendre, pas en recréer une.
                        fin_id = time.monotonic() + 8
                        while not params.get("campagne_id") and time.monotonic() < fin_id:
                            c2 = await _campagne(sw)
                            if c2 and c2.get("id") != ancien_id:
                                params["campagne_id"] = c2.get("id")
                                _maj(uid, type_, "en_cours", params, _compter(c2), "Envoi en cours…")
                                break
                            await asyncio.sleep(0.2)
                    pause_par_nous = False
                    # Limite du jour atteinte, ou arrêt prudent de l'extension : on réessaie plus tard.
                    prochaine_relance = time.monotonic() + (15 if not demarre else 600)
                if not test and not actif:
                    reveil = (float(params.get("reprise_a") or 0) if (pack and attente_pack)
                              else _prochaine_plage(p) if not dans_plage else 0.0)
                    if reveil - time.time() > SOMMEIL_MIN:
                        sommeil = reveil  # longue attente : on rend le navigateur, reprise automatique à l'heure
                        break
                if pause_par_nous or not dans_plage:
                    message = "Hors de la plage horaire : reprise à " + str(p.get("heure_debut", 8)) + " h."
                elif pack and attente_pack:
                    message = f"Pack terminé. Prochain pack de {pack} mails à {_heure(params['reprise_a'])}."
                elif pack and actif:
                    message = f"Pack en cours : {min(dans_pack, pack)} / {pack} mails."
                else:
                    message = "Envoi en cours…" if actif else (notice or "En attente…")
                _maj(uid, type_, "en_cours", params, prog, message)
                if time.monotonic() - sauvegarde > config.PAS_SAUVEGARDE:
                    await _ranger(uid, contexte, sw, type_)
                    sauvegarde = time.monotonic()
                await asyncio.sleep(config.PAS_SUIVI)
    except asyncio.CancelledError:
        interrompu = True
        raise
    except ErreurTravail as e:
        _maj(uid, type_, "erreur", params, prog, str(e))
    except Exception as e:
        print(f"[{type_}] compte {uid} : {type(e).__name__}: {navigateur.masquer(str(e))[:600]}", flush=True)
        await _diag(t, f"{type_} : {type(e).__name__}")
        if not test and isinstance(e, PlaywrightTimeout) and _relancer_plus_tard(uid, type_, params, OUTLOOK_GELE):
            _maj(uid, type_, "attente", params, prog, OUTLOOK_GELE)
        else:
            _maj(uid, type_, "erreur", params, prog, "L'envoi s'est arrêté sur une erreur inattendue. Rien n'est envoyé deux fois : relancez-le.")
    finally:
        if contexte is not None:
            try:
                await asyncio.shield(asyncio.wait_for(_ranger(uid, contexte, sw, type_), timeout=60))  # jamais bloqué par un Outlook gelé
            except BaseException:
                pass
            await _fermer(pw, contexte, dossier)
        if test:
            if _tests.get(uid) is t:
                _tests.pop(uid, None)
        elif not interrompu and _travaux.get((uid, type_)) is t:
            _travaux.pop((uid, type_), None)
    if sommeil and not interrompu:
        _dormir(uid, params, sommeil)
    if reprise_blocage and not interrompu:
        _reprendre_apres_blocage(uid, params)
