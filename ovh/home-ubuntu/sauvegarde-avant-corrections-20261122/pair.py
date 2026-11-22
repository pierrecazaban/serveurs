"""Liaison entre les deux serveurs Smart Mail (22/11).

Deux serveurs font tourner la même application, chacun avec sa base et ses sessions de messagerie :
le premier (OVH) garde les comptes déjà connectés, le second (Paris) reçoit tous les nouveaux. Une
session de messagerie ne change jamais de serveur : Microsoft et Google la verraient changer d'adresse.

Ce module tient les deux serveurs d'accord :
  - une adresse n'a de compte que sur UN serveur (vérifié à chaque connexion) ;
  - un élève qui a reçu le message depuis un serveur n'est plus jamais contacté depuis l'autre
    (les « reçus » et les types d'annuaire sont copiés en continu, et juste avant chaque mail) ;
  - la console du premier serveur montre l'état du second et l'ouvre en un clic.

Réglages (.env) : SMARTMAIL_SERVEUR (nom de ce serveur), SMARTMAIL_PAIR_URL, SMARTMAIL_PAIR_NOM,
SMARTMAIL_PAIR_SECRET (le même des deux côtés), SMARTMAIL_NOUVEAUX_COMPTES (1 : ce serveur accueille
les nouveaux comptes ; 0 : ils vont sur l'autre). Sans SMARTMAIL_PAIR_URL, rien de tout cela n'existe.
"""
import asyncio
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse

from . import base

SERVEUR = os.environ.get("SMARTMAIL_SERVEUR", "").strip().lower()
PAIR_URL = os.environ.get("SMARTMAIL_PAIR_URL", "").strip().rstrip("/")
PAIR_NOM = os.environ.get("SMARTMAIL_PAIR_NOM", "").strip().lower()
PAIR_SECRET = os.environ.get("SMARTMAIL_PAIR_SECRET", "").strip()
NOUVEAUX = os.environ.get("SMARTMAIL_NOUVEAUX_COMPTES", "1").strip() == "1"
WS = os.environ.get("SMARTMAIL_WS", "").strip().rstrip("/")  # wss://… de CE serveur (connexion en direct)
AILLEURS = -1          # « utilisateur » des élèves contactés depuis l'autre serveur
PAS = 300              # secondes entre deux copies
TOLERANCE = 180        # secondes d'écart d'horloge acceptées sur une signature

router = APIRouter()


def actif():
    return bool(PAIR_URL and PAIR_SECRET)


def marque(nom):
    """Début d'un message d'échec que l'application comprend : « va sur l'autre serveur »."""
    return f"[serveur:{nom}] "


# ------------------------------------------------------------------ signature
def _signer(chemin, t=None):
    t = str(int(t if t is not None else time.time()))
    return t + "." + hmac.new(PAIR_SECRET.encode(), (t + "\n" + chemin).encode(), hashlib.sha256).hexdigest()


def _signature_valide(valeur, chemin):
    if not PAIR_SECRET or not valeur or "." not in valeur:
        return False
    t, _ = valeur.split(".", 1)
    if not t.isdigit() or abs(time.time() - int(t)) > TOLERANCE:
        return False
    return hmac.compare_digest(valeur, _signer(chemin, int(t)))


def _exiger(request: Request):
    if not _signature_valide(request.headers.get("x-pair", ""), request.url.path):
        raise HTTPException(status_code=403, detail="Réservé à l'autre serveur Smart Mail.")


def appeler(chemin, params=None, delai=8, corps=None):
    """Appel signé à l'autre serveur. Lève OSError s'il ne répond pas."""
    if not actif():
        raise OSError("aucun autre serveur réglé")
    url = PAIR_URL + chemin + ("?" + urllib.parse.urlencode(params) if params else "")
    rq = urllib.request.Request(url, headers={"X-Pair": _signer(chemin), "User-Agent": "SmartMail-pair",
                                              "Content-Type": "application/json"},
                                data=json.dumps(corps).encode() if corps is not None else None)
    try:
        with urllib.request.urlopen(rq, timeout=delai) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as x:
        raise OSError(f"l'autre serveur a répondu {x.code}") from x
    except ValueError as x:
        raise OSError("réponse illisible de l'autre serveur") from x


# ------------------------------------------------------------------ un compte, un seul serveur
class Indisponible(Exception):
    pass


def place(adresse):
    """Où doit vivre le compte de cette adresse ? None : ici. Sinon le nom de l'autre serveur.
    Un compte déjà connu ici reste ici. Lève Indisponible si l'autre serveur ne répond pas
    (on ne crée jamais un compte sans savoir s'il existe déjà ailleurs)."""
    if not actif():
        return None
    adresse = (adresse or "").strip().lower()
    if base.utilisateur_par_email(adresse):
        return None
    try:
        connu = bool(appeler("/v1/pair/connu", {"adresse": adresse}, delai=6).get("connu"))
    except OSError as x:
        if NOUVEAUX:
            raise Indisponible(str(x)) from x
        return PAIR_NOM  # ce serveur ne crée plus de compte : de toute façon, c'est l'autre
    if connu:
        return PAIR_NOM
    return None if NOUVEAUX else PAIR_NOM


@router.get("/v1/pair/connu")
def connu(request: Request, adresse: str = ""):
    _exiger(request)
    return {"connu": bool(base.utilisateur_par_email(adresse.strip().lower()))}


# ------------------------------------------------------------------ élèves déjà contactés, types d'annuaire
def _etat_lire(cle, defaut=""):
    with base._verrou:
        r = base.cnx().execute("SELECT valeur FROM pair_etat WHERE cle = ?", (cle,)).fetchone()
    return r[0] if r else defaut


def _etat_ecrire(cle, valeur):
    with base._verrou:
        base.cnx().execute("INSERT INTO pair_etat (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur",
                           (cle, str(valeur)))
        base.cnx().commit()


LOT = 20000


@router.get("/v1/pair/contactes")
def contactes(request: Request, depuis: float = 0):
    """Les élèves qui ont REÇU le message depuis ce serveur (jamais ceux de l'autre, déjà chez lui)."""
    _exiger(request)
    with base._verrou:
        lignes = base.cnx().execute(
            "SELECT adresse, quand FROM contactes WHERE statut = 'recu' AND utilisateur_id > 0 AND quand >= ? ORDER BY quand LIMIT ?",
            (float(depuis), LOT)).fetchall()
    return {"lignes": [[a, q] for a, q in lignes], "plein": len(lignes) >= LOT}


@router.get("/v1/pair/types")
def types(request: Request, depuis: float = 0):
    _exiger(request)
    with base._verrou:
        lignes = base.cnx().execute("SELECT adresse, type, quand FROM types_annuaire WHERE quand >= ? ORDER BY quand LIMIT ?",
                                    (float(depuis), LOT)).fetchall()
    return {"lignes": [[a, t, q] for a, t, q in lignes], "plein": len(lignes) >= LOT}


def _copier(cle, chemin, inserer):
    """Copie par tranches ce que l'autre serveur a de nouveau depuis le dernier passage (bornes
    comprises : la dernière ligne est relue au passage suivant, rien n'est manqué)."""
    total = 0
    for _ in range(500):
        depuis = float(_etat_lire(cle, "0") or 0)
        r = appeler(chemin, {"depuis": repr(depuis)}, delai=30)
        lignes = r.get("lignes") or []
        if lignes:
            with base._verrou:
                inserer(lignes)
                base.cnx().commit()
            total += len(lignes)
        nouveau = max([float(l[-1]) for l in lignes], default=depuis)
        if nouveau > depuis:
            _etat_ecrire(cle, repr(nouveau))
        if not r.get("plein") or nouveau <= depuis:
            break
    return total


def _inserer_contactes(lignes):
    # Un élève servi par l'autre serveur n'est plus à personne ici. S'il n'était que « réservé » ici, la
    # réservation tombe (le prochain mail le saute) ; s'il a déjà reçu d'ici, la ligne d'ici reste.
    base.cnx().executemany(
        "INSERT INTO contactes (adresse, utilisateur_id, statut, quand) VALUES (?, ?, 'recu', ?) "
        "ON CONFLICT(adresse) DO UPDATE SET utilisateur_id = excluded.utilisateur_id, statut = 'recu', quand = excluded.quand "
        "WHERE contactes.statut = 'reserve'",
        [(str(a).lower(), AILLEURS, float(q)) for a, q in lignes])


def _inserer_types(lignes):
    base.cnx().executemany("INSERT INTO types_annuaire (adresse, type, quand) VALUES (?, ?, ?) ON CONFLICT(adresse) DO NOTHING",
                           [(str(a).lower(), str(ty), time.time()) for a, ty, _ in lignes])


_derniere_copie = {"quand": 0.0, "ok": None, "detail": ""}


def copier():
    """Une copie complète de ce que l'autre serveur a de nouveau. Rend True si elle a réussi."""
    if not actif():
        return True
    try:
        n = _copier("contactes_depuis", "/v1/pair/contactes", _inserer_contactes)
        _copier("types_depuis", "/v1/pair/types", _inserer_types)
        _derniere_copie.update(quand=time.time(), ok=True, detail=f"{n} élève(s) déjà contacté(s) reçus de l'autre serveur" if n else "")
        _etat_ecrire("copie_ok", repr(time.time()))
        return True
    except Exception as x:
        _derniere_copie.update(quand=time.time(), ok=False, detail=f"{type(x).__name__}: {x}")
        print(f"[pair] copie impossible : {type(x).__name__}: {x}", flush=True)
        return False


COPIE_MAX = 6 * 3600
_alerte = {"quand": 0.0}


async def avant_envoi(uid):
    """Juste avant de choisir les élèves d'un mail : ce que l'autre serveur vient d'envoyer. L'envoi n'est
    jamais bloqué ; si l'autre serveur ne répond plus depuis plus de 6 h, une alerte critique le dit
    (une par heure) : deux ambassadeurs d'une même école, un sur chaque serveur, pourraient se recouper."""
    if not actif():
        return
    if await run_in_threadpool(copier):
        return
    derniere = float(_etat_lire("copie_ok", "0") or 0)
    if time.time() - derniere > COPIE_MAX and time.time() - _alerte["quand"] > 3600:
        _alerte["quand"] = time.time()
        base.journal_noter(uid, "envoi", "L'autre serveur Smart Mail ne répond plus depuis plus de 6 h : impossible de savoir qui il a "
                                         "contacté entre-temps. L'envoi continue avec ce qui était connu.", "critique")


async def boucle():
    if not actif():
        return
    await asyncio.sleep(20)
    while True:
        await run_in_threadpool(copier)
        await asyncio.sleep(PAS)


# ------------------------------------------------------------------ écoles couvertes (relances, annuaire du site)
def _ecoles_ici():
    with base._verrou:
        lignes = base.cnx().execute(
            "SELECT o.adresse, o.etat != '' FROM outlook o JOIN utilisateurs u ON u.id = o.utilisateur_id "
            "WHERE u.actif = 1 AND o.adresse LIKE '%@%'").fetchall()
    return [{"domaine": str(a).split("@", 1)[1].lower().strip(), "session": bool(s)} for a, s in lignes]


@router.get("/v1/pair/ecoles")
def ecoles(request: Request):
    _exiger(request)
    return {"ecoles": _ecoles_ici()}


_ecoles_cache = {"quand": 0.0, "liste": []}


def ecoles_ailleurs(delai=300):
    """Les domaines des ambassadeurs de l'autre serveur (gardés quelques minutes). [] s'il ne répond pas
    et qu'on ne l'a jamais vu."""
    if not actif():
        return []
    if time.time() - _ecoles_cache["quand"] > delai:
        try:
            _ecoles_cache.update(liste=appeler("/v1/pair/ecoles", delai=6).get("ecoles") or [], quand=time.time())
        except OSError:
            pass
    return _ecoles_cache["liste"]


def ecoles_sures():
    """Comme ecoles_ailleurs, mais None si l'autre serveur n'a pas répondu depuis une heure."""
    liste = ecoles_ailleurs()
    return liste if time.time() - _ecoles_cache["quand"] < 3600 else None


# ------------------------------------------------------------------ état (console, surveillance)
def _lire(chemin):
    try:
        with open(chemin) as f:
            return f.read().strip()
    except OSError:
        return ""


def memoire():
    """(utilisée, plafond) en Mo pour ce conteneur, d'après le noyau. Plafond 0 : aucun."""
    util = _lire("/sys/fs/cgroup/memory.current")
    maxi = _lire("/sys/fs/cgroup/memory.max")
    inactif = 0
    for ligne in _lire("/sys/fs/cgroup/memory.stat").splitlines():
        if ligne.startswith("inactive_file "):
            inactif = int(ligne.split()[1])
    u = max(0, int(util or 0) - inactif) // 1048576
    return u, (int(maxi) // 1048576 if maxi.isdigit() else 0)


def etat_local():
    from . import config, travaux
    with base._verrou:
        c = base.cnx()
        comptes = c.execute("SELECT COUNT(*) FROM utilisateurs WHERE actif = 1").fetchone()[0]
        sessions = c.execute("SELECT COUNT(*) FROM outlook o JOIN utilisateurs u ON u.id = o.utilisateur_id WHERE u.actif = 1 AND o.etat != ''").fetchone()[0]
        taches = {f"{t}/{s}": n for t, s, n in c.execute("SELECT type, statut, COUNT(*) FROM taches GROUP BY 1, 2")}
        depuis = time.time() - 86400
        recus = c.execute("SELECT COUNT(*) FROM contactes WHERE statut = 'recu' AND utilisateur_id > 0 AND quand >= ?", (depuis,)).fetchone()[0]
    u, m = memoire()
    return {"serveur": SERVEUR, "comptes": comptes, "sessions": sessions, "taches": taches, "recus_24h": recus,
            "memoire_mo": u, "memoire_max_mo": m, "navigateurs": travaux.places_etat() if hasattr(travaux, "places_etat") else None,
            "navigateurs_max": config.NAVIGATEURS_MAX, "nouveaux": NOUVEAUX,
            "copie": {"quand": _derniere_copie["quand"], "ok": _derniere_copie["ok"], "detail": _derniere_copie["detail"]}}


@router.get("/v1/pair/etat")
def etat(request: Request):
    _exiger(request)
    return etat_local()


# ------------------------------------------------------------------ console de l'autre serveur, en un clic
@router.post("/v1/pair/entree")
def entree(request: Request):
    """L'autre serveur demande, pour SON administrateur connecté, une entrée dans la console d'ici :
    un jeton à usage unique, valable une minute."""
    _exiger(request)
    t = str(int(time.time()))
    return {"jeton": t + "." + hmac.new(PAIR_SECRET.encode(), ("entree\n" + t).encode(), hashlib.sha256).hexdigest()}


_entrees_vues = set()


@router.get("/pair/console")
def console(request: Request, j: str = ""):
    """Ouvre la console d'administration de ce serveur à l'administrateur venu de l'autre."""
    from . import cookie, porte
    t = j.split(".", 1)[0]
    attendu = t + "." + hmac.new(PAIR_SECRET.encode(), ("entree\n" + t).encode(), hashlib.sha256).hexdigest() if PAIR_SECRET else ""
    if not attendu or not t.isdigit() or abs(time.time() - int(t)) > 90 or not hmac.compare_digest(j, attendu) or j in _entrees_vues:
        return HTMLResponse("<p style='font:16px system-ui;padding:24px'>Lien expiré. Rouvrez la console depuis le premier serveur.</p>", status_code=403)
    _entrees_vues.add(j)
    with base._verrou:
        r = base.cnx().execute("SELECT id FROM utilisateurs WHERE role = 'administrateur' AND actif = 1 ORDER BY id LIMIT 1").fetchone()
    if not r:
        return HTMLResponse("<p style='font:16px system-ui;padding:24px'>Aucun administrateur sur ce serveur.</p>", status_code=409)
    jeton = base.ouvrir_session(r[0], "Console liée · autre serveur")
    page = ("<!doctype html><meta charset='utf-8'><title>Smart Mail</title><script>"
            "try{localStorage.setItem('smartmail',JSON.stringify({code:%s}))}catch(e){}location.replace('/admin');</script>" % json.dumps(jeton))
    rep = HTMLResponse(page, headers={"Cache-Control": "no-store"})
    rep.set_cookie(porte.COOKIE_ADMIN, porte.jeton_admin(r[0]), max_age=400 * 86400, httponly=True, samesite="lax", path="/",
                   secure=cookie._https(request))
    return rep
