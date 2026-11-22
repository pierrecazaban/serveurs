"""Relances des inscriptions non finalisées (14/11).

Un étudiant a rempli le formulaire d'inscription du site the-ai-certification.com mais n'a pas payé :
l'ambassadeur de son école lui écrit, depuis SA boîte (Outlook ou Gmail), un petit message personnel
avec le lien qui le ramène à son formulaire déjà rempli. Deux relances au plus :
  1. le lendemain de l'inscription ;
  2. la veille de la clôture des inscriptions.
Un mail à la fois, adressé à l'étudiant seul (pas de Cci), écrit comme un message normal, en fin
d'après-midi (heure de Paris), espacés de quelques minutes. Chaque relance est notée : jamais deux fois.

La liste vient du site (GET /api/relances) : il ne la donne qu'à l'IP de ce serveur (et, si une clé
RELANCES_API_KEY est réglée dans /admin, seulement avec la même clé dans /data/relances.cle).
"""
import asyncio
import json
import os
import random
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import base, config, navigateur, travaux

SITE = os.environ.get("RELANCES_URL", "https://the-ai-certification.com/api/relances")
PARIS = ZoneInfo("Europe/Paris")
PLAGE = (18, 21)          # heure de Paris : fin d'après-midi, avant les campagnes du soir
PAS = 600                 # un tour toutes les 10 min
ECART = (90, 240)         # secondes entre deux relances
PAR_JOUR = 25             # relances au plus par ambassadeur et par jour
# Écoles sans relance (domaine de l'école). IPSA retirée le 14/11 puis remise le 15/11, à la demande de Pierre.
SANS_RELANCE = set()
H = 3600

_JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def _cle():
    try:
        return (Path(config.BASE).parent / "relances.cle").read_text().strip()
    except OSError:
        return os.environ.get("RELANCES_CLE", "").strip()


def _init():
    with base._verrou:
        base.cnx().execute(
            "CREATE TABLE IF NOT EXISTS relances (inscription TEXT NOT NULL, etape INTEGER NOT NULL, utilisateur_id INTEGER, "
            "quand REAL NOT NULL, ok INTEGER NOT NULL, detail TEXT NOT NULL DEFAULT '', PRIMARY KEY (inscription, etape))")
        base.cnx().commit()


def _faites():
    with base._verrou:
        return {(r[0], r[1]): r[2] for r in base.cnx().execute("SELECT inscription, etape, ok FROM relances")}


def _noter(inscription, etape, uid, ok, detail=""):
    with base._verrou:
        base.cnx().execute("INSERT OR REPLACE INTO relances (inscription, etape, utilisateur_id, quand, ok, detail) VALUES (?, ?, ?, ?, ?, ?)",
                           (inscription, etape, uid, time.time(), 1 if ok else 0, detail[:300]))
        base.cnx().commit()


def _du_jour(uid):
    debut = datetime.now(PARIS).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    with base._verrou:
        return base.cnx().execute("SELECT COUNT(*) FROM relances WHERE utilisateur_id = ? AND ok = 1 AND quand >= ?", (uid, debut)).fetchone()[0]


def _lire_site():
    entetes = {"User-Agent": "SmartMail"}
    if _cle():
        entetes["x-relances-key"] = _cle()
    rq = urllib.request.Request(SITE, headers=entetes)
    with urllib.request.urlopen(rq, timeout=20) as r:
        return json.loads(r.read().decode()).get("registrations") or []


def _ambassadeurs():
    """École (domaine) -> [(uid, adresse, messagerie)] des ambassadeurs actifs dont la session est gardée."""
    with base._verrou:
        lignes = base.cnx().execute(
            "SELECT o.utilisateur_id, o.adresse, o.messagerie FROM outlook o JOIN utilisateurs u ON u.id = o.utilisateur_id "
            "WHERE u.actif = 1 AND o.etat != '' AND o.adresse LIKE '%@%' ORDER BY o.utilisateur_id").fetchall()
    par_ecole = {}
    for uid, adresse, messagerie in lignes:
        par_ecole.setdefault(base.ecole(adresse.split("@", 1)[1]), []).append((uid, adresse.lower(), messagerie or "outlook"))
    return par_ecole


def _ambassadeur_pour(inscr, par_ecole):
    domaines = list(inscr.get("school_domains") or []) + [inscr["email"].split("@", 1)[-1]]
    if any(base.ecole(d) in SANS_RELANCE for d in domaines):
        return None
    # Deux serveurs (22/11) : une école qui a un ambassadeur connecté sur le premier serveur est relancée
    # par lui seul ; le serveur des nouveaux comptes ne relance que les écoles qu'il est seul à couvrir.
    from . import pair
    if pair.actif() and pair.NOUVEAUX:
        ailleurs = pair.ecoles_sures()
        if ailleurs is None:
            return None  # l'autre serveur ne répond pas : on ne risque pas une relance en double
        couvertes = {base.ecole(e["domaine"]) for e in ailleurs if e.get("session")}
        if any(base.ecole(d) in couvertes for d in domaines):
            return None
    for d in domaines:
        for a in par_ecole.get(base.ecole(d), []):
            if a[1] != inscr["email"]:
                return a
    return None


def _jour(iso, francais):
    d = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(PARIS)
    if francais:
        return f"{_JOURS[d.weekday()]} {d.day} {_MOIS[d.month - 1]}"
    return f"{_DAYS[d.weekday()]}, {_MONTHS[d.month - 1]} {d.day}"


def _signature(adresse):
    local = adresse.split("@", 1)[0]
    if "." not in local:
        return ""
    prenom = re.split(r"[._-]", local)[0]
    return prenom[:1].upper() + prenom[1:] if prenom.isalpha() and len(prenom) > 1 else ""


def _a_l_ecole(nom):
    """« à l'IESEG », « à SKEMA », « à McGill »."""
    return ("à l'" if nom[:1].upper() in "AEIOUÉÈY" else "à ") + nom


def message(inscr, etape, adresse_ambassadeur):
    """Objet et texte, comme un message écrit à la main : le prénom, son école, le lien, une signature."""
    fr = inscr.get("locale") == "fr"
    prenom = inscr.get("first_name") or ""
    ecole_nom = inscr.get("school_short") or inscr.get("school") or ""
    jour = _jour(inscr["deadline"], fr)
    lien = inscr["link"]
    sig = _signature(adresse_ambassadeur)
    if fr:
        salut = f"Salut {prenom}," if prenom else "Salut,"
        parcours = f"pendant ton parcours {_a_l_ecole(ecole_nom)}" if ecole_nom else "pendant tes études"
        if etape == 1:
            objet = "Ton inscription à The AI Certification"
            texte = (f"{salut}\n\nTu as commencé ton inscription à The AI Certification, tu dois la finaliser avant le {jour} "
                     f"pour avoir la certification. Elle est très recherchée par les recruteurs, ça peut vraiment faire "
                     f"la différence pour décrocher les meilleurs stages {parcours}.\n\n"
                     f"Tes infos sont déjà remplies, ça prend 2 minutes :\n{lien}\n\n{sig}")
        else:
            objet = "Dernier rappel pour ton inscription"
            texte = (f"{salut}\n\nPetit rappel : les inscriptions à The AI Certification ferment demain. "
                     f"Tu dois finaliser avant demain soir ({jour}) pour avoir ta certification, un vrai plus pour tes candidatures de stage :\n"
                     f"{lien}\n\n{sig}")
    else:
        salut = f"Hi {prenom}," if prenom else "Hi,"
        parcours = f"during your time at {ecole_nom}" if ecole_nom else "during your studies"
        if etape == 1:
            objet = "Your AI Certification registration"
            texte = (f"{salut}\n\nYou started registering for The AI Certification, you need to finish it before {jour} to get the certification. It's one "
                     f"recruiters really look for, and it can make a real difference to land the best internships {parcours}.\n\n"
                     f"Your details are already filled in, it only takes 2 minutes:\n{lien}\n\n{sig}")
        else:
            objet = "Last reminder for your registration"
            texte = (f"{salut}\n\nQuick reminder: registration for The AI Certification closes tomorrow night ({jour}). "
                     f"You need to finish it to get your certification, a real plus for your internship applications:\n"
                     f"{lien}\n\n{sig}")
    return objet, texte.rstrip()


def etape_due(inscr, faites, maintenant=None, force=False):
    """1, 2 ou None. Relance 2 la veille de la clôture ; sinon relance 1 le lendemain de l'inscription.
    force : relance demandée tout de suite par l'administrateur (sans attendre le lendemain)."""
    m = maintenant or time.time()
    cree = datetime.fromisoformat(inscr["created_at"].replace("Z", "+00:00")).timestamp()
    fin = datetime.fromisoformat(inscr["deadline"].replace("Z", "+00:00")).timestamp()
    if fin <= m:
        return None
    if (inscr["id"], 2) in faites:
        return None
    if fin - m <= 30 * H and m - cree >= 3 * H:
        return 2
    if (inscr["id"], 1) not in faites and (force or m - cree >= 20 * H):
        return 1
    return None


# ------------------------------------------------------------------ envoi d'un message seul
def _page_ouverte(uid):
    """Un navigateur déjà ouvert sur ce compte (envoi, recherche) : la relance y prend un onglet."""
    for ty in ("envoi", "annuaire"):
        t = travaux.en_cours(uid, ty)
        page = getattr(t, "page", None) if t else None
        if page is not None and not getattr(t, "termine", False):
            try:
                if not page.is_closed():
                    return page
            except Exception:
                pass
    return None


async def _rediger_et_envoyer(page, gmail, a, objet, texte):
    q = urllib.parse.quote
    if gmail:
        url = f"https://mail.google.com/mail/u/0/?view=cm&fs=1&tf=1&to={q(a)}&su={q(objet)}&body={q(texte)}"
        bouton = page.locator('div[role="button"][data-tooltip^="Send"], div[role="button"][data-tooltip^="Envoyer"]').first
    else:
        url = f"https://outlook.office.com/mail/deeplink/compose?to={q(a)}&subject={q(objet)}&body={q(texte)}"
        bouton = page.get_by_role("button", name=re.compile(r"^(Send|Envoyer)$")).first
    await page.goto(url, wait_until="domcontentloaded")
    await bouton.wait_for(state="visible", timeout=90000)
    await asyncio.sleep(random.uniform(2, 4))
    await bouton.click()
    # Parti : la fenêtre de rédaction se ferme (ou Gmail annonce « Message envoyé »).
    fin = time.monotonic() + 45
    while time.monotonic() < fin:
        await asyncio.sleep(1)
        try:
            if not await bouton.is_visible():
                return True
        except Exception:
            return True
    return False


async def envoyer_un(uid, messagerie, a, objet, texte):
    if messagerie == "universel":
        from . import universel  # connexion universelle : envoi direct par SMTP
        return await universel.envoyer_simple(uid, a, objet, texte)
    gmail = messagerie == "gmail"
    page_job = _page_ouverte(uid)
    if page_job is not None:
        page = await page_job.context.new_page()
        try:
            return await _rediger_et_envoyer(page, gmail, a, objet, texte)
        finally:
            await page.close()
    async with travaux._place():
        if gmail:
            await navigateur.navigateur()
            async with navigateur.verrou_profil(uid):
                ctx = await navigateur.lancer_profil_gmail(navigateur._pw, navigateur.dossier_profil(uid))
                try:
                    page = ctx.pages[0] if ctx.pages else await ctx.new_page()
                    return await _rediger_et_envoyer(page, True, a, objet, texte)
                finally:
                    await ctx.close()
        ouvert = await navigateur.ouvrir(uid, {})
        if not ouvert:
            raise RuntimeError("session de messagerie fermée")
        ctx, page = ouvert
        try:
            return await _rediger_et_envoyer(page, False, a, objet, texte)
        finally:
            await navigateur.ranger(uid, ctx)


# ------------------------------------------------------------------ boucle
_verrou = asyncio.Lock()


def _drapeau():
    """Relance « tout de suite » demandée par l'administrateur : un fichier /data/relances-maintenant,
    utilisé une seule fois (hors plage horaire, sans attendre le lendemain de l'inscription)."""
    return Path(config.BASE).parent / "relances-maintenant"


async def tour(maintenant=None):
    force = _drapeau().exists()
    if force:
        try:
            _drapeau().unlink()
        except OSError:
            pass
        print("[relances] relance immédiate demandée par l'administrateur", flush=True)
    h = datetime.now(PARIS).hour
    if not force and not (PLAGE[0] <= h < PLAGE[1]):
        return 0
    if _verrou.locked():
        return 0
    async with _verrou:
        inscriptions = await asyncio.to_thread(_lire_site)
        faites = _faites()
        par_ecole = _ambassadeurs()
        envoyees = 0
        for inscr in inscriptions:
            etape = etape_due(inscr, faites, maintenant, force)
            if not etape:
                continue
            amb = _ambassadeur_pour(inscr, par_ecole)
            if not amb:
                continue  # pas d'ambassadeur connecté dans cette école : rien (pour l'instant)
            uid, adresse, messagerie = amb
            if _du_jour(uid) >= PAR_JOUR:
                continue
            if not force and datetime.now(PARIS).hour >= PLAGE[1]:
                break
            objet, texte = message(inscr, etape, adresse)
            try:
                ok = await envoyer_un(uid, messagerie, inscr["email"], objet, texte)
                detail = "" if ok else "envoi non confirmé"
            except Exception as x:
                ok, detail = False, f"{type(x).__name__}: {x}"
            qui = inscr.get("first_name") or "un étudiant"
            if ok:
                _noter(inscr["id"], etape, uid, True)
                faites[(inscr["id"], etape)] = 1
                envoyees += 1
                base.journal_noter(uid, "envoi", f"Relance {etape} envoyée à {qui} (inscription commencée sur le site, pas encore payée).", "succes")
            else:
                # Échec : noté pour la console, et retenté au prochain tour (une fois).
                essais = [k for k in faites if k == (inscr["id"], -etape)]
                _noter(inscr["id"], -etape, uid, False, detail)
                faites[(inscr["id"], -etape)] = 0
                print(f"[relances] compte {uid} : relance {etape} non envoyée ({detail})", flush=True)
                if essais:
                    _noter(inscr["id"], etape, uid, False, "abandon après 2 essais : " + detail)
                    faites[(inscr["id"], etape)] = 0
                    base.journal_noter(uid, "envoi", f"Relance {etape} à {qui} impossible : {detail[:120]}", "attention")
            await asyncio.sleep(random.uniform(*ECART))
        return envoyees


async def boucle():
    _init()
    await asyncio.sleep(60)
    while True:
        try:
            await tour()
        except Exception as x:
            print(f"[relances] {type(x).__name__}: {x}", flush=True)
        await asyncio.sleep(PAS)
