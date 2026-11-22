"""API du serveur Smart Mail.

  GET    /sante                      état du serveur (sans authentification)
  POST   /v1/connexion               adresse Outlook + mot de passe : le serveur se connecte à Outlook
  GET    /v1/connexion/{id}          où en est la connexion (validation sur le téléphone, code…)
  POST   /v1/connexion/{id}/code     code reçu par SMS ou dans l'application
  GET    /v1/compte                  le compte, son rôle, sa session Outlook, sa mémoire de travail
  GET    /v1/sessions                les appareils connectés à ce compte
  POST   /v1/tri                     trie une liste de contacts
  GET    /v1/admin/membres           (administrateurs) les ambassadeurs et leur consommation

Authentification : en-tête « Authorization: Bearer <jeton de session> ». Une
session appartient à un seul compte et ne donne accès qu'à ses données. Les codes
d'accès créés avec `python -m app.admin creer` (extension) marchent toujours.
"""

import hashlib
import hmac
import json
import os
from pathlib import Path
import asyncio
import time
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import base, config, cookie, demo, pair, pilote, porte, direct, ia as ia_mod, logique as logique_mod, navigateur, relances, service, travaux, universel

@asynccontextmanager
async def cycle(_app):
    entretien = None
    if config.ENTRETIEN_HEURES > 0:
        entretien = asyncio.get_running_loop().create_task(navigateur.entretien(config.ENTRETIEN_HEURES))
    reprise = None
    if config.REPRENDRE_TRAVAUX:
        # Envois et relevés interrompus par un redémarrage : ils repartent l'un après l'autre, en
        # arrière-plan (le serveur répond tout de suite).
        reprise = asyncio.get_running_loop().create_task(travaux.reprendre_apres_redemarrage())
    pilote.reglages = _parametres
    pilotage = asyncio.get_running_loop().create_task(pilote.boucle()) if config.REPRENDRE_TRAVAUX else None
    # Relances des inscriptions non payées, depuis la boîte de l'ambassadeur de l'école (14/11).
    relance = asyncio.get_running_loop().create_task(relances.boucle()) if config.REPRENDRE_TRAVAUX else None
    # Deux serveurs (22/11) : copie en continu de ce que l'autre a déjà contacté.
    liaison = asyncio.get_running_loop().create_task(pair.boucle()) if pair.actif() else None
    yield
    if liaison:
        liaison.cancel()
    if relance:
        relance.cancel()
    if pilotage:
        pilotage.cancel()
    if reprise and not reprise.done():
        reprise.cancel()
    if entretien:
        entretien.cancel()
    await travaux.fermer_tout()
    await direct.fermer_tout()
    await navigateur.fermer()


app = FastAPI(title="Smart Mail", version="1.0.0", docs_url=None, redoc_url=None, lifespan=cycle)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ORIGINES,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


class Contact(BaseModel):
    adresse: str = Field(max_length=320)
    nom: str = Field(default="", max_length=300)
    intitule: str = Field(default="", max_length=300)


class DemandeTri(BaseModel):
    contacts: list[Contact]
    logique: logique_mod.Logique | None = None


class Destinataire(BaseModel):
    adresse: str = Field(max_length=320)
    nom: str = Field(default="", max_length=300)
    source: str = Field(default="", max_length=20)


class AjoutDestinataires(BaseModel):
    personnes: list[Destinataire] = Field(max_length=2000)


class EtatRecherche(BaseModel):
    """Où en est la recherche : de quoi la reprendre sur n'importe quel appareil."""
    objectif: int = Field(ge=1)  # sans limite : tout l'annuaire si l'on veut
    depart: int | None = Field(default=0, ge=0)
    fini: bool = False
    ecartes: int = Field(default=0, ge=0)
    logique: logique_mod.Logique | None = None
    resume: str = Field(default="", max_length=400)


class Parametres(BaseModel):
    """Paramètres d'envoi, gardés dans le compte. L'envoi part par packs : « pack » mails, chacun
    à « destinataires » élèves au plus (en Cci au-delà d'un : aucun ne voit les autres), puis
    « attente » minutes de pause, puis le pack suivant, dans la plage horaire, sans jamais
    dépasser « max_jour » destinataires sur 24 h."""
    pack: int = Field(default=2, ge=1, le=500)              # mails par pack
    attente: int = Field(default=70, ge=1, le=1440)         # minutes de pause entre deux packs
    destinataires: int = Field(default=495, ge=1, le=495)   # destinataires par mail (Cci)
    max_jour: int = Field(default=9995, ge=1, le=9995)      # destinataires sur 24 h, au plus
    heure_debut: int = Field(default=8, ge=0, le=23)
    heure_fin: int = Field(default=20, ge=1, le=24)
    # Anciens réglages (comptes d'avant les packs) : toujours lus, plus proposés.
    taille_pack: int = Field(default=1, ge=1, le=100)
    packs_heure: int = Field(default=35, ge=1, le=120)
    preset: str = Field(default="packs", max_length=20)


# Préréglages et limites de chaque messagerie (juste sous les plafonds de Microsoft 365 :
# 10 000 destinataires par jour, 500 par mail ; de Google Workspace : 3 000 destinataires
# extérieurs par jour). Les packs étalent l'envoi sur la journée.
LIMITES = {
    "outlook": {"nom": "Microsoft", "destinataires": 495, "max_jour": 9995, "pack": 2, "attente": 70},
    "gmail": {"nom": "Google", "destinataires": 495, "max_jour": 2995, "pack": 1, "attente": 120},
    # Connexion universelle (16/11) : serveur SMTP de l'école, plafonds inconnus d'avance : prudence.
    "universel": {"nom": "École", "destinataires": 95, "max_jour": 2000, "pack": 1, "attente": 70},
}


def _limites(uid):
    return LIMITES.get((base.outlook_infos(uid) or {}).get("messagerie") or "outlook", LIMITES["outlook"])


def _parametres(uid):
    """Les réglages du compte : préréglages de sa messagerie (Microsoft ou Google), puis ses
    choix, jamais au-delà des limites de la messagerie. Les réglages d'avant (un mail par élève)
    laissent place au préréglage, en gardant la plage horaire."""
    lim = _limites(uid)
    brut = base.parametres_lire(uid) or {}
    if "destinataires" not in brut:
        brut = {k: v for k, v in brut.items() if k in ("heure_debut", "heure_fin")}
    try:
        p = Parametres(**{**{k: lim[k] for k in ("pack", "attente", "destinataires", "max_jour")}, **brut}).model_dump()
    except Exception:
        p = Parametres(**{k: lim[k] for k in ("pack", "attente", "destinataires", "max_jour")}).model_dump()
    p["destinataires"] = min(p["destinataires"], lim["destinataires"])
    p["max_jour"] = min(p["max_jour"], lim["max_jour"])
    p["limites"] = {k: lim[k] for k in ("nom", "destinataires", "max_jour")}
    return p


class DemandeLogique(BaseModel):
    echantillon: list[Contact] = Field(min_length=5, max_length=80)


_apprenti = None


def apprenti():
    global _apprenti
    if _apprenti is None:
        _apprenti = logique_mod.apprenti()
    return _apprenti


def definir_apprenti(a):
    """Pour les tests."""
    global _apprenti
    _apprenti = a


def _jeton(authorization):
    return authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""


async def utilisateur(authorization: str = Header(default="")):
    s, u = base.session_et_utilisateur(_jeton(authorization))
    if not u:
        raise HTTPException(status_code=401, detail="Session expirée ou fermée. Reconnectez-vous.")
    appareil = (s or {}).get("appareil") or ""
    if appareil.startswith(base.CONSOLE):
        # Un écran de la console : l'administrateur agit sur le compte de cet ambassadeur.
        base.ORIGINE.set(appareil.split("·", 1)[-1].strip() or "un administrateur")
        u = {**u, "_console": appareil}
    return u


def _hors_console(u, quoi):
    if u.get("_console"):
        raise HTTPException(status_code=403, detail=f"Impossible depuis la console : seul l'ambassadeur peut {quoi}.")


def administrateur(u=Depends(utilisateur)):
    if u.get("role") != "administrateur":
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs.")
    return u


def appareil(ua):
    """« iPhone · Safari », « Mac · Chrome »… pour reconnaître ses sessions."""
    ua = ua or ""
    systeme = next((n for m, n in (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android"), ("Windows", "Windows"),
                                   ("Macintosh", "Mac"), ("CrOS", "Chromebook"), ("Linux", "Linux")) if m in ua), "Appareil")
    nav = next((n for m, n in (("Edg/", "Edge"), ("OPR/", "Opera"), ("Firefox/", "Firefox"), ("CriOS", "Chrome"),
                               ("Chrome/", "Chrome"), ("Safari/", "Safari")) if m in ua), "navigateur")
    return f"{systeme} · {nav}"


def _profil(u):
    return {"nom": u["nom"], "email": u.get("email") or "", "role": u.get("role") or "ambassadeur"}


@app.get("/sante")
def sante():
    return {
        "ok": True,
        "ia": "simulation" if config.FAUX_CLAUDE else ("claude" if os.environ.get("ANTHROPIC_API_KEY") else "clé manquante"),
        "modele": config.MODELE,
    }


@app.get("/v1/moi")
def moi(u=Depends(utilisateur)):
    g = base.usage(u["id"])
    return {"nom": u["nom"], "role": u.get("role") or "ambassadeur",
            "quota": {"mensuel": u["quota_mensuel"], "utilise": g["contacts_ia"]},
            "contacts_tries_ce_mois": g["contacts_total"]}


@app.get("/v1/compte")
def compte(u=Depends(utilisateur)):
    """Tout ce qu'il faut pour reprendre là où on en était, sur n'importe quel appareil."""
    return {**_profil(u), "outlook": navigateur.etat_session(u["id"]),
            "destinataires": base.destinataires_compter(u["id"], "a_envoyer"), "recus": base.destinataires_compter(u["id"], "recus"),
            "extraits": base.extraits_compter(u["id"]),
            "recherche": base.recherche_lire(u["id"]), "parametres": _parametres(u["id"])}


# ------------------------------------------------------------------ connexion Outlook
class DemandeConnexion(BaseModel):
    email: str = Field(min_length=3, max_length=200, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    mot_de_passe: str = Field(min_length=1, max_length=256)


class CodeValidation(BaseModel):
    code: str = Field(min_length=4, max_length=12, pattern=r"^[0-9A-Za-z]+$")


def _ip(request):
    # uvicorn (--proxy-headers) a déjà remplacé l'adresse par celle que Caddy a vue :
    # on ne lit jamais X-Forwarded-For soi-même, le client pourrait l'écrire.
    return request.client.host if request.client else ""


@app.post("/v1/connexion", status_code=202)
async def connexion(demande: DemandeConnexion, request: Request):
    """Adresse Outlook + mot de passe. Le serveur se connecte à Outlook web à la
    place de la personne et garde la session ; le mot de passe n'est pas conservé."""
    adresse = demande.email.strip().lower()
    if config.DOMAINES and adresse.rsplit("@", 1)[-1] not in config.DOMAINES:
        raise HTTPException(status_code=403, detail="Utilisez l'adresse Outlook de votre établissement.")
    c = navigateur.demarrer(adresse, demande.mot_de_passe, appareil(request.headers.get("user-agent")), _ip(request))
    if not c:
        raise HTTPException(status_code=429, detail="Trop de tentatives. Réessayez dans un quart d'heure.")
    return c.vue()


def _connexion(cid):
    c = navigateur.trouver(cid)
    if not c:
        raise HTTPException(status_code=404, detail="Connexion expirée. Recommencez.")
    return c


@app.get("/v1/connexion/{cid}")
async def connexion_suivi(cid: str, request: Request, response: Response):
    """Où en est la connexion. Une fois réussie, rend la session de CET appareil,
    une seule fois, et pose le cookie de secours qui la garde ouverte."""
    c = _connexion(cid)
    if c.etape == "reussie":
        r = navigateur.remettre(c)
        cookie.poser(response, request, r["code"])
        return {"etape": "reussie", **r}
    if c.etape == "echec":
        navigateur.annuler(cid)
    return c.vue()


@app.post("/v1/connexion/{cid}/code")
async def connexion_code(cid: str, demande: CodeValidation):
    c = _connexion(cid)
    if c.etape != "code":
        raise HTTPException(status_code=409, detail="Aucun code n'est attendu pour le moment.")
    c.etape = "en_cours"
    await c.code_saisi.put(demande.code)
    return c.vue()


@app.delete("/v1/connexion/{cid}")
async def connexion_annuler(cid: str):
    navigateur.annuler(cid)
    return {"ok": True}


# ------------------------------------------------------------------ connexion en direct
class DemandeDirect(BaseModel):
    largeur: int = Field(ge=280, le=1600)
    hauteur: int = Field(ge=360, le=1400)
    dpr: float = Field(default=2, ge=1, le=3)
    messagerie: Literal["outlook", "gmail"] = "outlook"


@app.post("/v1/direct", status_code=202)
async def direct_ouvrir(demande: DemandeDirect, request: Request):
    """Ouvre la vraie page de connexion Microsoft, affichée en direct dans l'app."""
    e = await direct.ouvrir(demande.largeur, demande.hauteur, min(demande.dpr, 2),
                            appareil(request.headers.get("user-agent")), _ip(request), demande.messagerie)
    if not e:
        raise HTTPException(status_code=429, detail="Trop de tentatives. Réessayez dans un quart d'heure.")
    return e.vue()


@app.websocket("/v1/direct/{eid}/flux")
async def direct_flux(ws: WebSocket, eid: str):
    """Images de la page en direct vers l'app ; touchers et saisies vers la page.
    L'app peut se rebrancher (passage dans Authenticator, réseau qui saute)."""
    e = direct.trouver(eid)
    await ws.accept()
    if not e:
        await ws.send_json({"t": "etat", "id": eid, "etat": "echec", "message": "Connexion expirée. Recommencez."})
        await ws.close()
        return
    e.clients.add(ws)
    e.vu = time.monotonic()
    try:
        await ws.send_json({"t": "etat", **e.vue()})
        if e.image:
            await ws.send_json({"t": "image", "d": e.image, "w": e.largeur, "h": e.hauteur})
        while True:
            m = await ws.receive_json()
            if isinstance(m, dict):
                await direct.geste(e, m)
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        e.clients.discard(ws)
        e.vu = time.monotonic()


@app.get("/v1/direct/{eid}")
def direct_etat(eid: str):
    e = direct.trouver(eid)
    if not e:
        raise HTTPException(status_code=404, detail="Connexion expirée. Recommencez.")
    return e.vue()


@app.post("/v1/direct/{eid}/terminer")
def direct_terminer(eid: str, request: Request, response: Response):
    """Connexion réussie : la session de CET appareil, une seule fois."""
    e = direct.trouver(eid)
    if not e or e.etat != "reussie" or not e.resultat:
        raise HTTPException(status_code=409, detail="Connexion pas encore terminée.")
    r = direct.remettre(e)
    cookie.poser(response, request, r["code"])
    return r


@app.delete("/v1/direct/{eid}")
def direct_annuler(eid: str):
    return {"ok": direct.fermer(eid)}


# ------------------------------------------------------------------ connexion universelle
class DemandeUniversel(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    mot_de_passe: str = Field(min_length=1, max_length=500)
    identifiant: str = Field(default="", max_length=200)


@app.post("/v1/universel")
async def universel_connexion(demande: DemandeUniversel, request: Request, response: Response):
    """Toute autre messagerie d'école (Zimbra, Roundcube…) : adresse + mot de passe, vérifiés par IMAP/SMTP.
    Le mot de passe est gardé chiffré (il sert à chaque envoi)."""
    if universel.trop_d_essais(_ip(request)):
        raise HTTPException(status_code=429, detail="Trop de tentatives. Réessayez dans un quart d'heure.")
    adresse = demande.email.strip().lower()
    if config.DOMAINES and adresse.rsplit("@", 1)[-1] not in config.DOMAINES:
        raise HTTPException(status_code=403, detail="Utilisez l'adresse de votre établissement.")
    try:
        r = await universel.connecter(adresse, demande.mot_de_passe, demande.identifiant.strip(),
                                      appareil(request.headers.get("user-agent")))
    except universel.Echec as e:
        raise HTTPException(status_code=400, detail=str(e))
    cookie.poser(response, request, r["code"])
    return r


@app.post("/v1/session/reprendre")
def session_reprendre(request: Request, response: Response):
    """Au lancement de l'app, si elle a perdu son jeton : la session revient grâce
    au cookie de secours, sans se reconnecter."""
    jeton = cookie.lire(request)
    s, u = base.session_et_utilisateur(jeton) if jeton else (None, None)
    if not s or not u:
        # Pas de session ici : ce n'est pas une erreur, l'app montre la connexion.
        if jeton:
            cookie.effacer(response, request)
        return {"code": None}
    cookie.poser(response, request, jeton)  # repart pour 400 jours
    return {"code": jeton, **_profil(u)}


@app.get("/v1/outlook")
async def outlook_etat(verifier: bool = False, u=Depends(utilisateur)):
    """La session Outlook gardée par le serveur. `verifier=1` la rouvre pour de vrai."""
    if verifier and base.outlook_lire(u["id"]):
        await navigateur.verifier(u["id"])
    return navigateur.etat_session(u["id"])


@app.delete("/v1/outlook")
def outlook_retirer(request: Request, response: Response, u=Depends(utilisateur)):
    """Retire l'accès à Outlook : le serveur oublie la session Outlook et tous les
    appareils de ce compte sont déconnectés."""
    _hors_console(u, "retirer l'accès à sa messagerie")
    base.outlook_oublier(u["id"])
    base.deconnecter_tout(u["id"])
    base.journal_noter(u["id"], "session", "Accès à la messagerie retiré par l'ambassadeur : session oubliée, appareils déconnectés "
                                           "(sa liste et sa recherche sont gardées).", "attention")
    cookie.effacer(response, request)
    return {"ok": True}


# ------------------------------------------------------------------ regrouper l'annuaire, envoyer
class DemandeRegrouper(BaseModel):
    objectif: int = Field(ge=1)  # sans limite : tout l'annuaire si l'on veut
    nouvelle: bool = True  # False : continuer la liste existante
    # Extraire d'abord tout l'annuaire, sans tri ni IA ; « Garder seulement les étudiants » trie ensuite.
    extraction: bool = False


class DemandeEnvoi(BaseModel):
    objet: str = Field(min_length=1, max_length=255)
    texte: str = Field(min_length=1, max_length=20000)
    langue: Literal["en", "fr", "es", "de", "it"] = "en"  # langue de « {date} »
    debut: float | None = None  # envoi programmé : heure de départ (secondes depuis 1970) ; absent : tout de suite


class DemandeObjectif(BaseModel):
    objectif: int = Field(ge=1)  # sans limite haute


class DemandeProgrammer(BaseModel):
    debut: float | None = None  # None : commencer tout de suite


PROGRAMMATION_MAX = 90 * 86400  # au plus 90 jours à l'avance


GMAIL_BIENTOT = "Connecté avec Gmail : l'envoi depuis Gmail arrive bientôt dans Smart Mail (la collecte marche déjà)."


def _session_outlook(u, gmail_permis=False):
    o = base.outlook_lire(u["id"])
    if not o:
        raise HTTPException(status_code=409, detail="Aucune session Outlook sur le serveur : reconnectez-vous avec votre compte Outlook.")
    if (o.get("messagerie") or "outlook") == "gmail" and not gmail_permis:
        raise HTTPException(status_code=409, detail=GMAIL_BIENTOT)


@app.post("/v1/annuaire/regrouper", status_code=202)
async def regrouper(demande: DemandeRegrouper, u=Depends(utilisateur)):
    """Le serveur relève l'annuaire de l'établissement avec la session Outlook du
    compte, et garde les élèves jusqu'à l'objectif. Possible pendant un envoi."""
    _session_outlook(u, gmail_permis=True)  # Outlook ou Gmail
    if travaux.en_cours(u["id"], "annuaire"):
        raise HTTPException(status_code=409, detail="La recherche est déjà en cours.")
    if demande.nouvelle:
        if travaux.en_cours(u["id"], "envoi"):
            raise HTTPException(status_code=409, detail="Un envoi est en cours : continuez la recherche (les élèves trouvés s'ajoutent à « À envoyer »).")
        en_pause = base.travail_lire(u["id"], "envoi")
        if en_pause and en_pause["statut"] in ("pause", "erreur"):
            # L'envoi en pause visait l'ancienne liste : il est clos (rien ne part deux fois).
            base.travail_ecrire(u["id"], "envoi", "fini", en_pause["params"], en_pause.get("progression") or {},
                                "Envoi clos : une nouvelle recherche a remplacé la liste.")
        base.destinataires_vider(u["id"])
        base_recus = base.destinataires_compter(u["id"])  # il ne reste que les « Reçu »
    else:
        avant = base.travail_lire(u["id"], "annuaire")
        base_recus = int(((avant or {}).get("params") or {}).get("base_recus") or 0)
    travaux.lancer(u["id"], "annuaire", {"objectif": demande.objectif, "base_recus": base_recus, "extraction": demande.extraction})
    base.journal_noter(u["id"], "annuaire", ("Nouvelle recherche lancée" if demande.nouvelle else "Recherche relancée")
                       + f" (objectif {_n(demande.objectif)} élèves" + (", extraction d'abord" if demande.extraction else "") + ").")
    return travaux.etat(u["id"], "annuaire")


@app.put("/v1/annuaire/objectif")
def annuaire_objectif(demande: DemandeObjectif, u=Depends(utilisateur)):
    """L'objectif de la recherche, modifiable à tout moment : même pendant qu'elle tourne (elle
    s'arrête alors à ce nouveau nombre), ou avant de la reprendre."""
    travaux.changer_objectif(u["id"], demande.objectif)
    base.journal_noter(u["id"], "annuaire", f"Objectif de la recherche fixé à {_n(demande.objectif)} élèves.")
    return travaux.etat(u["id"], "annuaire")


@app.post("/v1/tri/lancer", status_code=202)
async def garder_les_etudiants(u=Depends(utilisateur)):
    """« Garder seulement les étudiants » : la logique de l'école est apprise sur tout
    l'annuaire extrait, puis chacun est trié (élèves → « À envoyer », les autres → « Exclus »).
    Possible à tout moment, même pendant l'extraction."""
    if travaux.en_cours(u["id"], "tri"):
        raise HTTPException(status_code=409, detail="Le tri est déjà en cours.")
    if not base.extraits_compter(u["id"]):
        raise HTTPException(status_code=409, detail="Rien à trier : lancez d'abord l'extraction de l'annuaire.")
    if travaux.en_cours(u["id"], "annuaire") and base.logique_lire(u["id"]) is not None:
        # La recherche trie déjà chaque nouveau contact (et rattrape ceux restés sans tri) :
        # relancer le tri réapprendrait la logique pour rien et trierait deux fois.
        raise HTTPException(status_code=409, detail="La recherche trie déjà automatiquement chaque nouveau contact avec la "
                                                    "logique de votre école : rien à lancer.")
    travaux.lancer(u["id"], "tri", {})
    base.journal_noter(u["id"], "tri", f"« Garder seulement les étudiants » lancé sur {_n(base.extraits_compter(u['id']))} contacts extraits.")
    return travaux.etat(u["id"], "tri")


def _pause_demandee(uid, type_, par=""):
    ok = travaux.arreter(uid, type_)
    if ok:
        base.journal_noter(uid, type_, f"{travaux.NOMS[type_]} : pause demandée" + (f" par l'administrateur {par}." if par else "."),
                           "attention" if par else "info")
    return ok


@app.post("/v1/tri/arreter")
def tri_arreter(u=Depends(utilisateur)):
    return {"ok": _pause_demandee(u["id"], "tri")}


@app.get("/v1/extraits")
def lister_extraits(depart: int = 0, taille: int = 500, u=Depends(utilisateur)):
    """Tout ce que la recherche a extrait de l'annuaire (avant tri)."""
    uid = u["id"]
    return {"personnes": base.extraits_lister(uid, max(0, depart), max(1, min(taille, 2000))),
            "total": base.extraits_compter(uid)}


@app.post("/v1/annuaire/arreter")
def regrouper_arreter(u=Depends(utilisateur)):
    """Met la recherche en pause : les élèves trouvés restent dans la liste."""
    return {"ok": _pause_demandee(u["id"], "annuaire")}


@app.post("/v1/envoi", status_code=202)
async def envoyer(demande: DemandeEnvoi, u=Depends(utilisateur)):
    """Le serveur envoie le message aux élèves trouvés jusqu'ici, depuis l'adresse
    Outlook du compte, au rythme et dans la plage horaire des paramètres. Possible
    pendant la recherche ; ceux trouvés ensuite partiront au prochain envoi (jamais
    deux fois la même personne)."""
    _session_outlook(u, gmail_permis=True)  # Outlook ou Gmail
    if travaux.en_cours(u["id"], "envoi"):
        raise HTTPException(status_code=409, detail="L'envoi est déjà en cours : les élèves trouvés depuis son lancement partiront automatiquement, à leur tour.")
    maintenant = time.time()
    debut = demande.debut if demande.debut and demande.debut > maintenant + 30 else None
    if debut and debut > maintenant + PROGRAMMATION_MAX:
        raise HTTPException(status_code=422, detail="Programmez l'envoi au plus 90 jours à l'avance.")
    if not debut and not base.destinataires_compter(u["id"], "a_envoyer"):
        raise HTTPException(status_code=409, detail="Aucun élève à qui envoyer : collectez d'autres élèves.")
    p = _parametres(u["id"])
    params = {"objet": demande.objet, "texte": demande.texte, "langue": demande.langue, "parametres": p}
    if debut:
        params["debut"] = debut
    travaux.lancer(u["id"], "envoi", params)
    base.journal_noter(u["id"], "envoi", ("Envoi programmé " + travaux.quand_fr(debut) if debut else "Envoi lancé")
                       + f" : {_n(base.destinataires_compter(u['id'], 'a_envoyer'))} élèves à envoyer, " + _rythme(p) + ".")
    return travaux.etat(u["id"], "envoi")


@app.post("/v1/envoi/programmer")
def envoi_programmer(demande: DemandeProgrammer, u=Depends(utilisateur)):
    """Un envoi programmé : changer son heure, ou le faire partir tout de suite (debut absent)."""
    debut = demande.debut
    if debut and debut > time.time() + PROGRAMMATION_MAX:
        raise HTTPException(status_code=422, detail="Programmez l'envoi au plus 90 jours à l'avance.")
    if not travaux.programmer(u["id"], debut if debut and debut > time.time() + 30 else None):
        raise HTTPException(status_code=409, detail="Aucun envoi programmé en attente.")
    base.journal_noter(u["id"], "envoi", "Envoi programmé déplacé " + travaux.quand_fr(debut) + "."
                       if debut and debut > time.time() + 30 else "Envoi programmé : départ avancé à maintenant.")
    return travaux.etat(u["id"], "envoi")


CONDITIONS_VERSION = "2026-11-13"
CONDITIONS_EMPREINTE = hashlib.sha256((Path(__file__).parent / "web" / "conditions.html").read_bytes()).hexdigest()


class DemandePilote(BaseModel):
    debut: float
    conditions: str | None = None  # version des conditions d'utilisation acceptées (case cochée)
    etudiants: int | None = Field(default=None, ge=1, le=500_000)  # plus demandé (gardé pour les anciennes apps)


@app.get("/v1/pilote")
def pilote_lire(u=Depends(utilisateur)):
    return pilote.vue(u["id"])


@app.post("/v1/pilote")
async def pilote_lancer(d: DemandePilote, request: Request, u=Depends(utilisateur)):
    """L'ambassadeur choisit la date et l'heure de l'envoi : collecte (jusqu'à 5 h avant), tri,
    envoi par packs et reprise après un blocage se font ensuite tout seuls (voir pilote.py)."""
    if d.debut < time.time() + 3600:
        raise HTTPException(status_code=422, detail="Choisissez une heure d'envoi dans au moins 1 heure (le temps de trouver vos étudiants).")
    if d.debut > time.time() + PROGRAMMATION_MAX:
        raise HTTPException(status_code=422, detail="Programmez l'envoi au plus 90 jours à l'avance.")
    if d.conditions != CONDITIONS_VERSION:
        raise HTTPException(status_code=422, detail="Cochez la case pour accepter les conditions d'utilisation.")
    _session_outlook(u, gmail_permis=True)
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
    base.acceptation_noter(u["id"], CONDITIONS_VERSION, CONDITIONS_EMPREINTE, ip, request.headers.get("user-agent", ""))
    base.journal_noter(u["id"], "session", f"Conditions d'utilisation acceptées (version {CONDITIONS_VERSION}) : "
                                           "l'ambassadeur certifie que son établissement a autorisé l'envoi.")
    pilote.demarrer(u["id"], d.debut, d.etudiants)
    return pilote.vue(u["id"])


@app.post("/v1/envoi/arreter")
def envoi_arreter(u=Depends(utilisateur)):
    """Met l'envoi en pause, après le mail en cours."""
    return {"ok": _pause_demandee(u["id"], "envoi")}


@app.post("/v1/envoi/reprendre", status_code=202)
async def envoi_reprendre(u=Depends(utilisateur)):
    """Reprend un envoi en pause (ou arrêté par une erreur) là où il en était."""
    _session_outlook(u, gmail_permis=True)  # Outlook ou Gmail
    if travaux.en_cours(u["id"], "envoi"):
        raise HTTPException(status_code=409, detail="Un envoi est déjà en cours.")
    t = base.travail_lire(u["id"], "envoi")
    if not t or t["statut"] == "fini":
        raise HTTPException(status_code=409, detail="Aucun envoi à reprendre.")
    params = dict(t["params"])
    params["parametres"] = _parametres(u["id"])
    # Reprise demandée par l'étudiant : le pack suivant part tout de suite.
    params.pop("reprise_a", None); params.pop("pack_debut", None)
    travaux.lancer(u["id"], "envoi", params)
    base.journal_noter(u["id"], "envoi", "Envoi repris.")
    return travaux.etat(u["id"], "envoi")


@app.post("/v1/envoi/test", status_code=202)
async def envoyer_test(demande: DemandeEnvoi, u=Depends(utilisateur)):
    """Envoie le message à soi-même, depuis Outlook, pour voir ce que recevront les
    élèves. Possible à tout moment, même pendant une recherche ou un envoi."""
    _session_outlook(u, gmail_permis=True)  # Outlook ou Gmail
    p = _parametres(u["id"])
    p.update({"heure_debut": 0, "heure_fin": 24, "taille_pack": 1})  # un test part tout de suite
    try:
        travaux.lancer_test(u["id"], {"objet": "[Test] " + demande.objet, "texte": demande.texte, "langue": demande.langue, "parametres": p})
    except travaux.ErreurTravail as e:
        raise HTTPException(status_code=409, detail=str(e))
    return travaux.etat_test(u["id"])


@app.get("/v1/envoi/test")
def etat_test(u=Depends(utilisateur)):
    return travaux.etat_test(u["id"])


@app.get("/v1/envoi/suivi")
def envoi_suivi(depuis: float = 0, u=Depends(utilisateur)):
    """Les élèves dont l'état d'envoi a changé depuis « depuis » : l'app les coche en direct."""
    changes, curseur = base.destinataires_suivi(u["id"], depuis)
    return {"changes": changes, "curseur": curseur}


@app.get("/v1/travail")
def travail(u=Depends(utilisateur)):
    """Où en sont la recherche et l'envoi (ils peuvent tourner ensemble)."""
    return {"annuaire": travaux.etat(u["id"], "annuaire"), "envoi": travaux.etat(u["id"], "envoi"),
            "tri": travaux.etat(u["id"], "tri")}


# ------------------------------------------------------------------ appareils
@app.get("/v1/sessions")
def sessions(authorization: str = Header(default=""), u=Depends(utilisateur)):
    ici = base.hacher(_jeton(authorization))
    return {"sessions": [{"ref": s["jeton_hash"][:16], "appareil": s["appareil"] or "Appareil", "depuis": s["cree"],
                          "vu": s["vu"] or s["cree"], "ici": s["jeton_hash"] == ici} for s in base.sessions_lister(u["id"])]}


@app.delete("/v1/sessions/{ref}")
def fermer_session(ref: str, u=Depends(utilisateur)):
    if not base.session_fermer(u["id"], ref):
        raise HTTPException(status_code=404, detail="Session introuvable.")
    return {"ok": True}


@app.delete("/v1/sessions")
def fermer_autres_sessions(authorization: str = Header(default=""), u=Depends(utilisateur)):
    """Déconnecte tous les autres appareils de ce compte."""
    _hors_console(u, "déconnecter ses appareils")
    return {"fermees": base.deconnecter_tout(u["id"], sauf=base.hacher(_jeton(authorization)))}


# ------------------------------------------------------------------ administration
@app.get("/v1/admin/membres")
def admin_membres(u=Depends(administrateur)):
    return {"membres": [{**m, "actif": bool(m["actif"]), "outlook": bool(m["outlook"]), "cout_usd": round(m["cout_usd"], 2)}
                        for m in base.rapport()],
            "depense_mois": round(base.depense_du_mois(), 2), "budget_mois": config.BUDGET_MENSUEL_USD}


NOMS_TRAVAUX = {"annuaire": "La recherche", "tri": "Le tri", "envoi": "L'envoi"}
IMMOBILE_ALERTE = 15 * 60  # un travail en cours sans aucun progrès depuis 15 min : alerte
# Attentes normales d'un envoi (pas un blocage) : pause entre deux packs, hors de la plage
# horaire, limite du jour, ou tous servis pendant que la recherche cherche les suivants.
ATTENTES_NORMALES = ("Hors de la plage horaire", "Tous les élèves trouvés", "Limite de", "Pack terminé")
_DEMARRAGE = time.time()


def _n(v):
    return f"{int(v or 0):,}".replace(",", "\u202f")


def _rythme(p):
    p = p or {}
    pack = (f"packs de {p.get('pack')} mails à {p.get('destinataires') or 1} destinataires au plus, pause de {p.get('attente')} min, "
            f"{_n(p.get('max_jour'))} par jour au plus" if p.get("pack") else "sans packs")
    return f"{pack}, de {p.get('heure_debut', 8)} h à {p.get('heure_fin', 20)} h"


def _serveur():
    """Charge de la machine, mémoire, disque, base : de quoi voir venir un serveur saturé."""
    try:
        c1, c5, _ = os.getloadavg()
    except (OSError, AttributeError):
        c1 = c5 = 0.0
    memoire = disque = None
    try:
        infos = dict(ligne.split(":", 1) for ligne in open("/proc/meminfo").read().splitlines() if ":" in ligne)
        total, libre = (int(infos[k].split()[0]) * 1024 for k in ("MemTotal", "MemAvailable"))
        memoire = {"total": total, "utilise": total - libre}
    except Exception:
        pass
    try:
        import shutil
        d = shutil.disk_usage(config.BASE.parent)
        disque = {"total": d.total, "utilise": d.used}
    except Exception:
        pass
    octets = 0
    for suffixe in ("", "-wal"):
        try:
            octets += Path(str(config.BASE) + suffixe).stat().st_size
        except OSError:
            pass
    return {"charge": round(c1, 2), "charge_5": round(c5, 2), "coeurs": os.cpu_count() or 1, "memoire": memoire,
            "disque": disque, "base_octets": octets, "demarre": _DEMARRAGE}


def _fiche_membre(m):
    """Ce qu'un administrateur doit voir d'un ambassadeur, et ses alertes."""
    uid = m["id"]
    qui = m.get("email") or m.get("nom") or f"compte {uid}"
    o = base.outlook_infos(uid)
    connecte = bool(o and o.get("active"))
    travaux_ = {ty: travaux.etat(uid, ty) for ty in ("annuaire", "tri", "envoi")}
    pe = travaux_["envoi"].get("progression") or {}
    liste = {"a_envoyer": base.destinataires_compter(uid, "a_envoyer"), "recus": base.destinataires_compter(uid, "recus"),
             "exclus": base.exclus_compter(uid), "extraits": base.extraits_compter(uid),
             "a_trier": base.extraits_compter(uid, non_tries=True)}
    alertes = []

    def alerte(niveau, texte):
        alertes.append({"niveau": niveau, "texte": texte, "membre": uid})

    if pe.get("blocage"):
        alerte("critique", f"Microsoft a bloqué la boîte de {qui} pour l'envoi (« Undeliverable » 5.1.8) : son envoi est en pause.")
    for ty, e in travaux_.items():
        if e["statut"] == "erreur":
            niveau = "critique" if "indisponible" in (e.get("message") or "") else "attention"
            alerte(niveau, f"{NOMS_TRAVAUX[ty]} de {qui} s'est arrêté : {e.get('message') or 'erreur'}")
    if not connecte and travaux_["envoi"]["statut"] == "attente":
        alerte("critique", f"{qui} n'a plus de session de messagerie alors qu'un envoi est programmé : il doit se reconnecter dans l'application.")
    elif not connecte and (liste["a_envoyer"] or liste["a_trier"] or any(e["statut"] in ("pause", "erreur") for e in travaux_.values())):
        alerte("attention", f"{qui} n'a plus de session de messagerie sur le serveur : il doit se reconnecter dans l'application.")
    if pe.get("non_distribues"):
        alerte("info", f"{pe['non_distribues']} élève(s) n'ont pas reçu le message de {qui} (adresse introuvable).")
    # Un travail « en cours » qui n'avance plus (ex. une recherche figée sur le même nombre).
    maintenant = time.time()
    for ty, e in travaux_.items():
        if not (e.get("actif") and e["statut"] == "en_cours" and e.get("progres")):
            continue
        pr = e.get("progression") or {}
        attendu = ty == "envoi" and ((pr.get("pack") or {}).get("prochain")
                                     or any(x in (e.get("message") or "") for x in ATTENTES_NORMALES))
        immobile = maintenant - e["progres"]
        if immobile >= IMMOBILE_ALERTE and not attendu:
            e["immobile"] = int(immobile)
            alerte("attention", f"{NOMS_TRAVAUX[ty]} de {qui} n'avance plus depuis {int(immobile // 60)} min "
                                f"({e.get('message') or 'en cours'}).")
    r = _parametres(uid)
    fiche = {
        "id": uid, "email": m.get("email") or "", "nom": m.get("nom") or "", "role": m.get("role"), "actif": bool(m.get("actif")),
        "ecole": (m.get("email") or "").rsplit("@", 1)[-1],
        "session": {"connecte": connecte, "messagerie": (o or {}).get("messagerie") or "outlook",
                    "verifie": (o or {}).get("verifie") or None, "depuis": (o or {}).get("connecte") or None},
        "activite": base.derniere_activite(uid),
        "appareils": m.get("appareils", 0),
        "travaux": {ty: {"statut": e["statut"], "actif": e.get("actif"), "message": e.get("message") or "",
                         "progression": e.get("progression") or {}, "progres": e.get("progres"),
                         "immobile": e.get("immobile", 0), "maj": e.get("maj")} for ty, e in travaux_.items()},
        "liste": liste,
        "pilote": pilote.lire(uid),
        "rythme": {k: r.get(k) for k in ("pack", "attente", "heure_debut", "heure_fin")},
        "ia": {"contacts": m.get("contacts_ia", 0), "cout": round(m.get("cout_usd", 0) or 0, 2), "quota": m.get("quota_mensuel")},
    }
    return fiche, alertes


def _tableau():
    fiches, alertes = [], []
    for m in base.rapport():
        f, a = _fiche_membre(m)
        fiches.append(f)
        if f["role"] != "administrateur" and f["email"]:  # un administrateur patrouille, il ne collecte pas
            alertes.extend(a)
    # Les ambassadeurs : pas les administrateurs (ils patrouillent), ni un compte sans adresse
    # (ancien code d'accès de test : ni messagerie ni application).
    amb = [f for f in fiches if f["role"] != "administrateur" and f["email"]]
    sante = ia_mod.SANTE
    if sante["panne"] and sante["panne"] > sante["ok"] and time.time() - sante["panne"] < 6 * 3600:
        conseil = " Rechargez le crédit sur console.anthropic.com." if "crédit" in sante["raison"] else ""
        alertes.insert(0, {"niveau": "critique", "membre": None,
                           "texte": f"Claude ne répond plus ({sante['raison']}) : les tris sont en pause.{conseil}"})
    depense, budget = base.depense_du_mois(), config.BUDGET_MENSUEL_USD
    if budget and depense >= 0.8 * budget:
        alertes.append({"niveau": "attention", "membre": None,
                        "texte": f"Dépense IA du mois : {depense:.2f} $ sur {budget:.0f} $ de budget."})
    alertes.extend(pair.alertes())  # mémoire de ce serveur, et santé de l'autre (22/11)
    charge = travaux.charge()
    en_attente = sum(1 for f in amb for e in f["travaux"].values()
                     if e["statut"] == "attente" and not (e.get("progression") or {}).get("programme"))
    if en_attente and charge["navigateurs"] >= charge["maximum"]:
        alertes.append({"niveau": "attention", "membre": None,
                        "texte": f"Serveur plein : {en_attente} travail(aux) attendent un navigateur libre."})
    serveur = _serveur()
    if serveur["charge_5"] >= 1.5 * serveur["coeurs"]:
        alertes.append({"niveau": "attention", "membre": None,
                        "texte": f"Serveur très chargé (charge {serveur['charge_5']} pour {serveur['coeurs']} cœurs) : tout ralentit."})
    if serveur["disque"] and serveur["disque"]["utilise"] >= 0.9 * serveur["disque"]["total"]:
        alertes.append({"niveau": "critique", "membre": None, "texte": "Disque du serveur presque plein (plus de 90 %)."})
    ordre = {"critique": 0, "attention": 1, "info": 2}
    alertes.sort(key=lambda a: ordre.get(a["niveau"], 3))
    total = {
        "membres": sum(1 for f in amb if f["actif"]), "sessions": sum(1 for f in amb if f["session"]["connecte"]),
        "recherches": sum(1 for f in amb if f["travaux"]["annuaire"]["actif"]),
        "tris": sum(1 for f in amb if f["travaux"]["tri"]["actif"]),
        "envois": sum(1 for f in amb if f["travaux"]["envoi"]["actif"]),
        "a_envoyer": sum(f["liste"]["a_envoyer"] for f in amb), "recus": sum(f["liste"]["recus"] for f in amb),
        "recus_jour": base.recus_par_jour(None, 1, config.FUSEAU)[0]["n"],
        "depense": round(depense, 2), "budget": budget, **charge,
    }
    en_panne = bool(sante["panne"] and sante["panne"] > sante["ok"] and time.time() - sante["panne"] < 6 * 3600)
    return {"total": total, "alertes": alertes, "membres": fiches, "serveur": serveur, "maintenant": time.time(),
            "ia": {"ok": not en_panne, "raison": sante["raison"] if en_panne else "", "depuis": sante["panne"] if en_panne else sante["ok"]}}


@app.get("/v1/admin/tableau")
def admin_tableau(u=Depends(administrateur)):
    """Le tableau de bord : vue d'ensemble, alertes, une fiche par ambassadeur."""
    return _tableau()


@app.get("/v1/admin/alertes")
def admin_alertes(u=Depends(administrateur)):
    a = _tableau()["alertes"]
    return {"nombre": len(a), "critiques": sum(1 for x in a if x["niveau"] == "critique")}


class PauseAdmin(BaseModel):
    travail: Literal["annuaire", "tri", "envoi"]


@app.post("/v1/admin/membres/{uid}/pause")
def admin_pause(uid: int, demande: PauseAdmin, u=Depends(administrateur)):
    """Un administrateur met en pause la recherche, le tri ou l'envoi d'un ambassadeur."""
    if not base.utilisateur_par_id(uid):
        raise HTTPException(status_code=404, detail="Membre introuvable.")
    return {"ok": _pause_demandee(uid, demande.travail, par=u.get("email") or u.get("nom") or "")}


@app.post("/v1/admin/membres/{uid}/reprendre", status_code=202)
async def admin_reprendre(uid: int, demande: PauseAdmin, u=Depends(administrateur)):
    """Un administrateur relance la recherche, le tri ou l'envoi en pause d'un ambassadeur, là où
    il en était (un envoi garde son rythme : la pause entre deux packs est respectée)."""
    if not base.utilisateur_par_id(uid):
        raise HTTPException(status_code=404, detail="Membre introuvable.")
    ty = demande.travail
    if travaux.en_cours(uid, ty):
        raise HTTPException(status_code=409, detail="Déjà en cours.")
    t = base.travail_lire(uid, ty)
    if ty in ("annuaire", "envoi") and not base.outlook_lire(uid):
        raise HTTPException(status_code=409, detail="Pas de session de messagerie sur le serveur : l'ambassadeur doit d'abord se reconnecter.")
    if ty == "annuaire":
        if not t:
            raise HTTPException(status_code=409, detail="Aucune recherche à reprendre.")
        p = t["params"] or {}
        params = {"objectif": p.get("objectif") or 500, "base_recus": p.get("base_recus") or 0, "extraction": bool(p.get("extraction"))}
    elif ty == "tri":
        if not base.extraits_compter(uid):
            raise HTTPException(status_code=409, detail="Rien à trier.")
        params = {}
    else:
        if not t or t["statut"] == "fini":
            raise HTTPException(status_code=409, detail="Aucun envoi à reprendre.")
        params = dict(t["params"])
        params["parametres"] = _parametres(uid)
    travaux.lancer(uid, ty, params)
    base.journal_noter(uid, ty, f"{travaux.NOMS[ty]} : reprise demandée par l'administrateur {u.get('email') or u.get('nom')}.")
    return travaux.etat(uid, ty)


@app.get("/v1/admin/membres/{uid}/detail")
def admin_detail(uid: int, u=Depends(administrateur)):
    """Tout sur un ambassadeur : sa fiche, sa messagerie, ses appareils, son rythme, ses envois
    jour par jour, ses derniers envois et son journal."""
    m = next((x for x in base.rapport() if x["id"] == uid), None)
    if not m:
        raise HTTPException(status_code=404, detail="Membre introuvable.")
    fiche, alertes = _fiche_membre(m)
    o = base.outlook_infos(uid) or {}
    pa = (base.travail_lire(uid, "annuaire") or {}).get("params") or {}
    pe = (base.travail_lire(uid, "envoi") or {}).get("params") or {}
    return {
        **fiche, "alertes": alertes,
        "messagerie": {"adresse": o.get("adresse") or "", "type": o.get("messagerie") or "outlook", "connecte": bool(o.get("active")),
                       "depuis": o.get("connecte") or None, "verifie": o.get("verifie") or None},
        "appareils_liste": [{"ref": s["jeton_hash"][:16], "appareil": s["appareil"] or "Appareil", "depuis": s["cree"],
                             "vu": s["vu"] or s["cree"]} for s in base.sessions_lister(uid)],
        "recherche": {"objectif": pa.get("objectif"), "extraction": bool(pa.get("extraction"))},
        "message": {"objet": pe.get("objet") or "", "langue": pe.get("langue") or ""},
        "envois_jour": base.recus_par_jour(uid, 14, config.FUSEAU),
        "derniers": base.derniers_servis(uid, 15),
        "journal": base.journal_lire(uid, taille=80),
        "maintenant": time.time(),
    }


@app.get("/v1/admin/journal")
def admin_journal(avant: int = 0, taille: int = 60, membre: int | None = None, problemes: bool = False,
                  u=Depends(administrateur)):
    """Le fil d'activité de tous les ambassadeurs, du plus récent au plus ancien."""
    taille = max(1, min(taille, 200))
    lignes = base.journal_lire(membre, avant or None, taille, problemes)
    return {"evenements": lignes, "suite": lignes[-1]["id"] if len(lignes) == taille else None}


@app.delete("/v1/admin/membres/{uid}/appareils/{ref}")
def admin_deconnecter_appareil(uid: int, ref: str, u=Depends(administrateur)):
    if not base.session_fermer(uid, ref):
        raise HTTPException(status_code=404, detail="Appareil introuvable.")
    base.journal_noter(uid, "session", f"Un appareil a été déconnecté par l'administrateur {u.get('email') or u.get('nom')}.")
    return {"ok": True}


@app.post("/v1/admin/membres/{uid}/ecran")
def admin_ouvrir_ecran(uid: int, u=Depends(administrateur)):
    """Un écran de la console : l'application de cet ambassadeur, exactement comme il la voit,
    avec tous ses boutons (collecter, trier, rédiger, envoyer…). Une session « Console
    administrateur » est ouverte sur son compte, visible dans ses appareils ; elle se ferme
    avec l'écran, et au plus tard au bout de 12 h."""
    cible = base.utilisateur_par_id(uid)
    if not cible:
        raise HTTPException(status_code=404, detail="Membre introuvable.")
    if not cible.get("actif"):
        raise HTTPException(status_code=409, detail="L'accès de ce membre est coupé : rétablissez-le d'abord.")
    base.sessions_console_fermer(heures=12)
    par = u.get("email") or u.get("nom") or "un administrateur"
    appareil = f"{base.CONSOLE} · {par}"
    if not base.sessions_console_compter(uid, appareil, 30):
        base.journal_noter(uid, "session", f"Écran ouvert dans la console par {par}.")
    return {"jeton": base.ouvrir_session(uid, appareil), "email": cible.get("email") or "", "nom": cible.get("nom") or ""}


@app.delete("/v1/admin/membres/{uid}/ecran")
def admin_fermer_ecran(uid: int, u=Depends(administrateur)):
    return {"fermees": base.sessions_console_fermer(uid, f"{base.CONSOLE} · {u.get('email') or u.get('nom') or 'un administrateur'}")}


@app.get("/admin", include_in_schema=False)
def console_admin():
    """La console d'administration (page à part, pensée pour le téléphone)."""
    return FileResponse(Path(__file__).parent / "web" / "admin.html", headers={"Cache-Control": "no-cache"})


class ModifMembre(BaseModel):
    role: str | None = Field(default=None, pattern="^(ambassadeur|administrateur)$")
    actif: bool | None = None
    quota_mensuel: int | None = Field(default=None, ge=0, le=10_000_000)


@app.put("/v1/admin/membres/{uid}")
def admin_modifier(uid: int, m: ModifMembre, u=Depends(administrateur)):
    cible = base.utilisateur_par_id(uid)
    if not cible:
        raise HTTPException(status_code=404, detail="Membre introuvable.")
    perd_admin = cible["role"] == "administrateur" and cible["actif"] and (m.role == "ambassadeur" or m.actif is False)
    if perd_admin and base.administrateurs_actifs() <= 1:
        raise HTTPException(status_code=409, detail="Il doit rester au moins un administrateur.")
    par = u.get("email") or u.get("nom")
    if m.role is not None:
        base.definir_role(uid, m.role)
        if m.role != cible["role"]:
            base.journal_noter(uid, "compte", f"Rôle changé en « {m.role} » par {par}.")
    if m.quota_mensuel is not None:
        base.definir_quota(uid, m.quota_mensuel)
        if m.quota_mensuel != cible["quota_mensuel"]:
            base.journal_noter(uid, "compte", f"Quota mensuel fixé à {_n(m.quota_mensuel)} contacts par {par}.")
    if m.actif is not None:
        base.definir_actif(uid, m.actif)  # désactiver ferme aussi ses sessions
        if bool(m.actif) != bool(cible["actif"]):
            base.journal_noter(uid, "compte", (f"Accès rétabli par {par}." if m.actif else
                                               f"Accès coupé par {par} : tous ses appareils sont déconnectés."),
                               "info" if m.actif else "attention")
    return next(x for x in admin_membres(u)["membres"] if x["id"] == uid)


@app.get("/v1/destinataires")
def lister_destinataires(depart: int = 0, taille: int = 500, u=Depends(utilisateur)):
    taille = max(1, min(taille, 2000))
    uid = u["id"]
    return {"personnes": base.destinataires_lister(uid, max(0, depart), taille), "total": base.destinataires_compter(uid),
            "a_envoyer": base.destinataires_compter(uid, "a_envoyer"), "recus": base.destinataires_compter(uid, "recus"),
            "exclus": base.exclus_compter(uid), "extraits": base.extraits_compter(uid),
            "a_trier": base.extraits_compter(uid, non_tries=True),
            "logique": (base.logique_lire(uid) or {}).get("resume", "")}


class AjoutExclus(BaseModel):
    adresses: list[str] = Field(min_length=1, max_length=5000)


class RetraitListe(BaseModel):
    adresses: list[str] = Field(min_length=1, max_length=5000)


@app.post("/v1/destinataires/retirer")
async def retirer_destinataires(demande: RetraitListe, u=Depends(utilisateur)):
    """« Retirer de la liste » : ces élèves ne recevront rien (même s'ils étaient dans un envoi
    en cours) ; ils passent dans « Exclus », d'où l'on peut les rajouter."""
    uid = u["id"]
    retirees = base.destinataires_retirer_main(uid, demande.adresses)
    if retirees:
        await travaux.sauter_dans_l_envoi(uid)
    return {"retires": len(retirees), "a_envoyer": base.destinataires_compter(uid, "a_envoyer"), "exclus": base.exclus_compter(uid)}


@app.get("/v1/exclus")
def lister_exclus(depart: int = 0, taille: int = 200, genre: str = "", u=Depends(utilisateur)):
    """Les contacts écartés par le tri, avec la raison (incertain, personnel, service…)."""
    uid = u["id"]
    return {"personnes": base.exclus_lister(uid, max(0, depart), max(1, min(taille, 500)), genre or None),
            "total": base.exclus_compter(uid), "par_genre": base.exclus_par_genre(uid)}


@app.post("/v1/exclus/ajouter")
async def ajouter_exclus(demande: AjoutExclus, u=Depends(utilisateur)):
    """L'étudiant a reconnu des élèves parmi les exclus : ils passent dans « À envoyer »
    (jamais quelqu'un qui a déjà reçu le message), et le tri s'en souvient."""
    uid = u["id"]
    noms = base.exclus_lire(uid, demande.adresses)
    adresses = [a for a in noms]  # seulement de vrais exclus de ce compte
    if adresses:
        base.destinataires_ajouter(uid, [{"adresse": a, "nom": noms[a], "source": "manuel"} for a in adresses])
        base.exclus_retirer(uid, adresses)
        base.cache_ecrire([(a, "etudiant", "etudiant", "ajouté à la main par l'étudiant", "manuel") for a in adresses])
        base.sauts_retablir(uid, adresses)  # retirés puis rajoutés : la campagne ne les saute plus
        await travaux.sauter_dans_l_envoi(uid)
    return {"ajoutes": len(adresses), "a_envoyer": base.destinataires_compter(uid, "a_envoyer"), "exclus": base.exclus_compter(uid)}


@app.post("/v1/destinataires")
def ajouter_destinataires(demande: AjoutDestinataires, u=Depends(utilisateur)):
    return {"total": base.destinataires_ajouter(u["id"], [p.model_dump() for p in demande.personnes])}


@app.delete("/v1/destinataires")
def vider_destinataires(u=Depends(utilisateur)):
    base.destinataires_vider(u["id"])
    return {"total": 0}


@app.put("/v1/recherche")
def enregistrer_recherche(etat: EtatRecherche, u=Depends(utilisateur)):
    base.recherche_ecrire(u["id"], etat.model_dump())
    return {"ok": True}


@app.put("/v1/parametres")
def enregistrer_parametres(p: Parametres, u=Depends(utilisateur)):
    if p.heure_fin <= p.heure_debut:
        raise HTTPException(status_code=422, detail="L'heure de fin doit suivre l'heure de début.")
    lim = _limites(u["id"])
    d = p.model_dump()
    d["destinataires"] = min(d["destinataires"], lim["destinataires"])  # jamais au-delà de la messagerie
    d["max_jour"] = min(d["max_jour"], lim["max_jour"])
    d["taille_pack"] = 1  # ancien réglage, remplacé par « destinataires »
    avant = base.parametres_lire(u["id"]) or {}
    for garde in ("deja_jusqua", "pilote", "parrain"):  # jamais perdus : borne des déjà contactés, pilote automatique
        if avant.get(garde):
            d[garde] = avant[garde]
    base.parametres_ecrire(u["id"], d)
    return _parametres(u["id"])


@app.post("/v1/deconnexion")
def deconnexion(request: Request, response: Response, authorization: str = Header(default=""), u=Depends(utilisateur)):
    base.deconnecter(_jeton(authorization))
    if not u.get("_console"):  # la console ne touche jamais au cookie de l'administrateur
        cookie.effacer(response, request)
    return {"ok": True}


@app.post("/v1/tri")
async def tri(demande: DemandeTri, u=Depends(utilisateur)):
    if len(demande.contacts) > config.MAX_CONTACTS_PAR_REQUETE:
        raise HTTPException(status_code=413, detail=f"{config.MAX_CONTACTS_PAR_REQUETE} contacts au plus par envoi.")
    if not config.FAUX_CLAUDE and not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=503, detail="Le tri IA n'est pas encore configuré sur le serveur (clé manquante).")
    # Les appels à Claude sont bloquants : hors de la boucle asynchrone.
    lg = logique_mod.nettoyer(demande.logique) if demande.logique else None
    return await run_in_threadpool(service.trier, u, [c.model_dump() for c in demande.contacts], lg)


@app.post("/v1/logique")
async def apprendre_logique(demande: DemandeLogique, u=Depends(utilisateur)):
    """Étape de lancement : Claude déduit la logique de l'école d'un échantillon (~30 personnes)."""
    if not config.FAUX_CLAUDE and not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=503, detail="Le tri IA n'est pas encore configuré sur le serveur (clé manquante).")
    if base.depense_du_mois() >= config.BUDGET_MENSUEL_USD:
        raise HTTPException(status_code=429, detail="Budget IA du mois atteint.")
    lg, cout, erreur = await run_in_threadpool(apprenti().apprendre, [c.model_dump() for c in demande.echantillon])
    base.ajouter_usage(u["id"], cout_usd=cout)
    if lg is None:
        raise HTTPException(status_code=502, detail=erreur or "logique introuvable")
    return {"logique": lg.model_dump(), "resume": lg.resume, "cout_usd": round(cout, 4)}


@app.get("/v1/config")
def config_publique():
    """Ce que l'application a besoin de savoir au démarrage."""
    # Deux serveurs (22/11) : « serveur » = celui-ci ; « ailleurs » = où va un appareil sans session
    # (les nouveaux comptes) ; « ws » = l'adresse directe de ce serveur pour la connexion en direct.
    return {"demo": config.DEMO, "fuseau": config.FUSEAU, "serveur": pair.SERVEUR if pair.actif() else "",
            "ailleurs": pair.PAIR_NOM if pair.actif() and not pair.NOUVEAUX else "", "ws": pair.WS}


# L'app installée sur l'écran d'accueil ne doit jamais mélanger une ancienne version
# du script avec une nouvelle page (écran noir) : chaque fichier de l'interface est
# revalidé à chaque ouverture (rien n'est retéléchargé s'il n'a pas changé).
@app.middleware("http")
async def interface_fraiche(request, appel_suivant):
    r = await appel_suivant(request)
    chemin = request.url.path
    if not chemin.startswith(("/v1/", "/demo/", "/sante")):
        r.headers["Cache-Control"] = "no-cache"
    return r


@app.middleware("http")
async def porte_du_jour(request, appel_suivant):
    """Sans le code du jour : la page de mot de passe. Les sessions déjà ouvertes (jeton) et les envois continuent."""
    if not config.PORTE_SECRET:
        return await appel_suivant(request)
    chemin = request.url.path
    if (chemin in ("/sante", "/porte", "/v1/porte/code-admin", "/v1/porte/ecoles", "/pair/console", "/porte/site") or chemin.startswith("/v1/pair/")
            or porte.valide(request.cookies.get(porte.COOKIE))
            or (request.cookies.get(porte.COOKIE_ADMIN)
                and await run_in_threadpool(porte.admin_valide, request.cookies.get(porte.COOKIE_ADMIN)))):
        return await appel_suivant(request)
    if chemin.startswith(("/v1/", "/demo/")):
        jeton = _jeton(request.headers.get("authorization", ""))
        if jeton and await run_in_threadpool(base.utilisateur_par_jeton, jeton):
            return await appel_suivant(request)
        return JSONResponse({"detail": "Code d'accès du jour requis : rechargez la page."}, status_code=401)
    if chemin.endswith((".js", ".css", ".png", ".webmanifest")):
        return Response(status_code=401)
    return HTMLResponse(porte.PAGE, headers={"Cache-Control": "no-store"})


class CodePorte(BaseModel):
    code: str = Field(max_length=20)


@app.post("/porte")
async def entrer(c: CodePorte, request: Request):
    if porte.trop_d_essais():
        raise HTTPException(status_code=429, detail="Trop d'essais. Réessayez dans quelques minutes.")
    parrain = None
    if not porte.verifier(c.code):
        parrain = await run_in_threadpool(porte.code_perso, c.code)  # code personnel d'un ambassadeur (18/11)
        if not parrain:
            porte.echec()
            await asyncio.sleep(1)
            raise HTTPException(status_code=403, detail="Code incorrect.")
    r = JSONResponse({"ok": True})
    r.set_cookie(porte.COOKIE, porte.jeton(), max_age=2 * 86400, httponly=True, samesite="lax", path="/",
                 secure=cookie._https(request))
    if parrain:
        r.set_cookie(porte.COOKIE_PARRAIN, parrain, max_age=400 * 86400, httponly=True, samesite="lax", path="/",
                     secure=cookie._https(request))
    return r


def _noter_parrain(jeton, code):
    """Le compte connecté garde le code personnel tapé à l'entrée (le premier seulement) : son ambassadeur long terme."""
    u = base.utilisateur_par_jeton(jeton)
    if not u:
        return
    d = base.parametres_lire(u["id"]) or {}
    if d.get("parrain"):
        return
    d["parrain"] = code
    base.parametres_ecrire(u["id"], d)


@app.middleware("http")
async def noter_parrain(request, appel_suivant):
    rep = await appel_suivant(request)
    code = request.cookies.get(porte.COOKIE_PARRAIN)
    if code and rep.status_code < 400 and request.url.path.startswith("/v1/"):
        jeton = _jeton(request.headers.get("authorization", ""))
        if jeton:
            try:
                await run_in_threadpool(_noter_parrain, jeton, code[:12])
            except Exception:
                pass
    return rep


# ------------------------------------------------------------------ console : l'envoi d'un ambassadeur
LANGUES = ("fr", "en", "es", "de", "it")
RYTHME = ("pack", "attente", "destinataires", "max_jour")


def _envoi_admin(uid):
    """Tout ce que la console montre et règle de l'envoi d'un ambassadeur."""
    lim, r = _limites(uid), _parametres(uid)
    e = base.travail_lire(uid, "envoi")
    pr = (e or {}).get("params") or {}
    if e and e["statut"] != "fini" and pr.get("objet") and pr.get("texte"):
        objet, texte, langue = pr["objet"], pr["texte"], pr.get("langue") or "en"
    else:
        objet, texte, langue = pilote.message(uid)
    pl = pilote.lire(uid) or {}
    debut = pl.get("debut") or (pr.get("debut") if e and e["statut"] == "attente" else None)
    return {"objet": objet, "texte": texte, "langue": langue, "langues": list(LANGUES), "debut": debut,
            "rythme": {k: r[k] for k in RYTHME}, "plage": [r["heure_debut"], r["heure_fin"]],
            "limites": {k: lim[k] for k in ("nom", "destinataires", "max_jour")}, "pilote": bool(pl), "fuseau": config.FUSEAU}


@app.get("/v1/admin/membres/{uid}/envoi")
def admin_envoi(uid: int, u=Depends(administrateur)):
    if not base.utilisateur_par_id(uid):
        raise HTTPException(status_code=404, detail="Membre introuvable.")
    return _envoi_admin(uid)


class ModifEnvoi(BaseModel):
    langue: Literal["fr", "en", "es", "de", "it"] | None = None
    objet: str | None = Field(default=None, max_length=300)
    texte: str | None = Field(default=None, max_length=20000)
    debut: float | None = None
    pack: int | None = Field(default=None, ge=1, le=500)
    attente: int | None = Field(default=None, ge=1, le=1440)
    destinataires: int | None = Field(default=None, ge=1, le=495)
    max_jour: int | None = Field(default=None, ge=1, le=9995)
    heure_debut: int | None = Field(default=None, ge=0, le=23)
    heure_fin: int | None = Field(default=None, ge=1, le=24)


@app.put("/v1/admin/membres/{uid}/envoi")
async def admin_modifier_envoi(uid: int, m: ModifEnvoi, u=Depends(administrateur)):
    """Langue, message, date et rythme de l'envoi d'un ambassadeur, depuis la console. Appliqué à l'envoi
    programmé ou en cours (en direct), et gardé pour les suivants."""
    if not base.utilisateur_par_id(uid):
        raise HTTPException(status_code=404, detail="Membre introuvable.")
    par = u.get("email") or "l'administrateur"
    # Message (une langue seule : le message type de cette langue)
    if m.langue or m.objet is not None or m.texte is not None:
        actuel = _envoi_admin(uid)
        if m.langue and m.objet is None and m.texte is None:
            objet, texte = pilote.MODELES[m.langue]
        else:
            objet = m.objet if m.objet is not None else actuel["objet"]
            texte = m.texte if m.texte is not None else actuel["texte"]
        if not objet.strip() or not texte.strip():
            raise HTTPException(status_code=422, detail="L'objet et le message ne peuvent pas être vides.")
        nouveau = {"objet": objet, "texte": texte, "langue": m.langue or actuel["langue"]}
        d = base.parametres_lire(uid) or {}
        d["message"] = nouveau
        base.parametres_ecrire(uid, d)
        travaux.maj_envoi(uid, lambda prm: prm.update(nouveau))
        base.journal_noter(uid, "envoi", f"Message modifié depuis la console par {par} (langue : {nouveau['langue']}).")
    # Rythme (jamais au-delà des limites de la messagerie)
    vals = {k: getattr(m, k) for k in RYTHME if getattr(m, k) is not None}
    if vals:
        lim, r = _limites(uid), _parametres(uid)
        vals["destinataires"] = min(vals.get("destinataires", r["destinataires"]), lim["destinataires"])
        vals["max_jour"] = min(vals.get("max_jour", r["max_jour"]), lim["max_jour"])
        d = base.parametres_lire(uid) or {}
        for k in RYTHME + ("heure_debut", "heure_fin"):
            d.setdefault(k, r[k])
        d.update(vals)
        d["taille_pack"] = 1
        base.parametres_ecrire(uid, d)
        p = _parametres(uid)
        travaux.maj_envoi(uid, lambda prm: prm.setdefault("parametres", {}).update({k: p[k] for k in RYTHME}))
        base.journal_noter(uid, "envoi", f"Rythme modifié depuis la console par {par} : " + _rythme(p) + ".")
    # Plage horaire (heure de Paris), appliquée en direct à l'envoi en cours ou programmé
    if m.heure_debut is not None or m.heure_fin is not None:
        r = _parametres(uid)
        hd = m.heure_debut if m.heure_debut is not None else r["heure_debut"]
        hf = m.heure_fin if m.heure_fin is not None else r["heure_fin"]
        if hf <= hd:
            raise HTTPException(status_code=422, detail="L'heure de fin doit être après l'heure de début.")
        d = base.parametres_lire(uid) or {}
        for k in RYTHME:
            d.setdefault(k, r[k])
        d["heure_debut"], d["heure_fin"] = hd, hf
        base.parametres_ecrire(uid, d)
        travaux.maj_envoi(uid, lambda prm: prm.setdefault("parametres", {}).update({"heure_debut": hd, "heure_fin": hf}))
        base.journal_noter(uid, "envoi", f"Plage d'envoi modifiée depuis la console par {par} : de {hd} h à {hf} h.")
    # Date et heure
    if m.debut is not None:
        if m.debut < time.time() + 60:
            raise HTTPException(status_code=422, detail="Choisissez une date et une heure à venir.")
        if m.debut > time.time() + PROGRAMMATION_MAX:
            raise HTTPException(status_code=422, detail="Programmez l'envoi au plus 90 jours à l'avance.")
        e = base.travail_lire(uid, "envoi")
        if pilote.lire(uid) or not (e and e["statut"] == "attente"):
            pilote.demarrer(uid, m.debut)
        else:
            pilote._plage_pour(uid, m.debut)
            p = _parametres(uid)
            travaux.programmer(uid, m.debut)
            travaux.maj_envoi(uid, lambda prm: (prm.update({"debut": m.debut}),
                                                prm.setdefault("parametres", {}).update({"heure_debut": p["heure_debut"], "heure_fin": p["heure_fin"]})))
        base.journal_noter(uid, "envoi", f"Date d'envoi fixée depuis la console par {par} : {travaux.quand_fr(m.debut)}.")
    return _envoi_admin(uid)


SITE_ADMIN = os.environ.get("SITE_ADMIN_URL", "https://the-ai-certification.com/api/admin/whoami")


@app.get("/v1/porte/ecoles")
def porte_ecoles(request: Request):
    """Les écoles des ambassadeurs connectés (domaine de leur messagerie) : le site
    the-ai-certification.com les ajoute d'office à son annuaire (14/11). Rien d'autre : ni nom, ni adresse."""
    with base._verrou:
        lignes = base.cnx().execute(
            "SELECT o.adresse FROM outlook o JOIN utilisateurs u ON u.id = o.utilisateur_id "
            "WHERE u.actif = 1 AND o.adresse LIKE '%@%'").fetchall()
    domaines = {str(r[0]).split("@", 1)[1].lower().strip() for r in lignes}
    if not request.headers.get("x-pair"):  # les écoles de l'autre serveur aussi (jamais en boucle)
        domaines |= {str(e.get("domaine") or "") for e in pair.ecoles_ailleurs()}
    domaines = sorted(domaines)
    perso = ("gmail.com", "outlook.com", "hotmail.com", "hotmail.fr", "live.com", "yahoo.com", "yahoo.fr", "icloud.com", "orange.fr", "free.fr")
    ecoles = [{"domaine": d, "ecole": base.ecole(d)} for d in domaines if d and d not in perso]
    return JSONResponse({"ecoles": ecoles}, headers={"Cache-Control": "no-store"})


@app.get("/v1/porte/code-admin")
async def porte_code_admin(request: Request):
    """Le code du jour pour la page /admin du site the-ai-certification.com (même domaine, via /tool) :
    le cookie de session du site est montré au site lui-même, qui dit seulement si c'est son admin."""
    import urllib.request
    session = request.cookies.get("cfx_session")
    if not session or not config.PORTE_SECRET:
        raise HTTPException(status_code=401, detail="Connexion administrateur du site requise.")

    def demander():
        rq = urllib.request.Request(SITE_ADMIN, headers={"Cookie": "cfx_session=" + session, "User-Agent": "SmartMail"})
        with urllib.request.urlopen(rq, timeout=8) as r:
            return r.status == 200 and json.loads(r.read().decode()).get("admin") is True
    try:
        admin = await run_in_threadpool(demander)
    except Exception:
        admin = False
    if not admin:
        raise HTTPException(status_code=403, detail="Réservé à l'administrateur du site.")
    return JSONResponse({"code": porte.code(), "jour": porte.jour()}, headers={"Cache-Control": "no-store"})


@app.get("/v1/admin/porte")
def admin_porte(request: Request, response: Response, u=Depends(administrateur)):
    """Le code du jour, pour le donner aux ambassadeurs. Et le cookie administrateur (400 jours) :
    sur cet appareil, la console s'ouvre ensuite sans le code du jour."""
    if config.PORTE_SECRET and not porte.admin_valide(request.cookies.get(porte.COOKIE_ADMIN)):
        response.set_cookie(porte.COOKIE_ADMIN, porte.jeton_admin(u["id"]), max_age=400 * 86400, httponly=True,
                            samesite="lax", path="/", secure=cookie._https(request))
    return {"code": porte.code() if config.PORTE_SECRET else "", "jour": porte.jour()}


# ------------------------------------------------------------------ passerelle avec le site (23/11)
# Le site et Smart Mail se font confiance par la clé partagée des relances (RELANCES_API_KEY côté site, /data/relances.cle
# ici) : le site signe un laissez-passer pour ouvrir /tool ; Smart Mail signe un jeton qui dit au site quel ambassadeur
# est connecté, pour lui ouvrir son espace ambassadeur.
def _signer(donnees):
    import base64
    cle = relances._cle()
    corps = base64.urlsafe_b64encode(json.dumps(donnees).encode()).decode().rstrip("=")
    return corps + "." + hmac.new(cle.encode(), corps.encode(), hashlib.sha256).hexdigest()


def _lire_signe(t):
    import base64
    cle = relances._cle()
    try:
        corps, sig = str(t or "").split(".", 1)
        if not cle or not hmac.compare_digest(sig, hmac.new(cle.encode(), corps.encode(), hashlib.sha256).hexdigest()):
            return None
        d = json.loads(base64.urlsafe_b64decode(corps + "=" * (-len(corps) % 4)))
    except Exception:
        return None
    return d if float(d.get("exp") or 0) > time.time() else None


@app.get("/porte/site")
def porte_site(request: Request, t: str = ""):
    """Laissez-passer signé par le site : ouvre la porte (et note le parrain), puis l'app."""
    d = _lire_signe(t)
    if not d:
        return HTMLResponse(porte.PAGE, headers={"Cache-Control": "no-store"})
    r = RedirectResponse("/tool" + ("?espace=1" if d.get("espace") else ""), status_code=303)
    r.set_cookie(porte.COOKIE, porte.jeton(), max_age=2 * 86400, httponly=True, samesite="lax", path="/", secure=cookie._https(request))
    if d.get("parrain"):
        r.set_cookie(porte.COOKIE_PARRAIN, str(d["parrain"])[:12], max_age=400 * 86400, httponly=True, samesite="lax", path="/",
                     secure=cookie._https(request))
    return r


# Deux serveurs : le même numéro de compte existe sur chacun. Le site reçoit donc un numéro décalé pour le second
# (SMARTMAIL_UID_DECALAGE dans son .env), jamais deux ambassadeurs sous le même numéro.
UID_DECALAGE = int(os.environ.get("SMARTMAIL_UID_DECALAGE", "0"))


@app.get("/v1/site/jeton")
def site_jeton(u=Depends(utilisateur)):
    """Jeton signé (5 min) qui ouvre au site l'espace ambassadeur de ce compte, une fois son envoi programmé."""
    _hors_console(u, "ouvrir son espace ambassadeur")
    if u.get("role") != "ambassadeur":
        raise HTTPException(status_code=403, detail="Réservé aux ambassadeurs.")
    if not relances._cle():
        raise HTTPException(status_code=503, detail="L'espace ambassadeur n'est pas encore relié à Smart Mail. Réessayez plus tard.")
    if not (pilote.lire(u["id"]) or {}).get("debut"):
        raise HTTPException(status_code=409, detail="Programmez d'abord votre envoi.")
    d = base.parametres_lire(u["id"]) or {}
    return {"t": _signer({"uid": u["id"] + UID_DECALAGE, "email": (u.get("email") or u.get("nom") or "").lower(),
                          "parrain": d.get("parrain") or "", "exp": time.time() + 300})}


# ------------------------------------------------------------------ l'autre serveur (22/11)
@app.get("/v1/admin/pair")
async def admin_pair(u=Depends(administrateur)):
    """Pour la console : l'état de ce serveur et de l'autre (mémoire, comptes, tâches, copie)."""
    if not pair.actif():
        return {"actif": False}
    try:
        autre = await run_in_threadpool(pair.appeler, "/v1/pair/etat", None, 6)
        erreur = ""
    except OSError as x:
        autre, erreur = None, str(x)
    return {"actif": True, "ici": pair.etat_local(), "autre": autre, "autre_nom": pair.PAIR_NOM, "erreur": erreur}


@app.post("/v1/admin/pair/console")
async def admin_pair_console(u=Depends(administrateur)):
    """Un lien à usage unique (une minute) vers la console de l'autre serveur."""
    if not pair.actif():
        raise HTTPException(status_code=404, detail="Aucun autre serveur.")
    try:
        r = await run_in_threadpool(pair.appeler, "/v1/pair/entree", None, 6, {})
    except OSError as x:
        raise HTTPException(status_code=502, detail=f"L'autre serveur ne répond pas ({x}).")
    base.journal_noter(u["id"], "session", f"Console du serveur « {pair.PAIR_NOM} » ouverte depuis celui-ci.")
    return {"url": pair.PAIR_URL + "/pair/console?j=" + r["jeton"]}


app.include_router(pair.router)
app.include_router(demo.router)
# L'application (PWA) : servie à la racine, après les routes de l'API.
app.mount("/", StaticFiles(directory=Path(__file__).parent / "web", html=True), name="web")
