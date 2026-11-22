"""Pilote automatique. L'ambassadeur choisit seulement la date et l'heure de l'envoi ; le reste se fait tout seul, étape par étape (chacune notée au journal, visible dans la console) :

1. Collecte : l'annuaire, sans objectif, jusqu'à 5 h avant l'envoi (ou jusqu'au bout de l'annuaire).
2. Tri : seuls les étudiants restent (personnel, associations, comptes techniques → « Exclus »).
3. Programmé : l'envoi attend son heure (il est programmé dès le choix de l'ambassadeur).
4. Envoi : par packs, au maximum de la messagerie (Outlook ou Gmail).
5. Blocage de la boîte : 24 h d'attente, puis le « mode IESEG » : 1 mail par jour de 90 étudiants en Cci
   (90 par jour au plus) ; de même à chaque nouveau blocage.

Rien n'est jamais vidé : la collecte continue la liste existante, le tri ne retire personne de la liste."""
import asyncio
import json
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path

from . import base, config, travaux

SANS_LIMITE = 10_000_000      # la recherche ne s'arrête jamais d'elle-même sur un nombre
MARGE_COLLECTE = 5 * 3600     # la collecte s'arrête 5 h avant l'envoi (le temps du tri)
ATTENTE_BLOCAGE = 24 * 3600   # après un blocage, 24 h avant de reprendre
PAS = 60                      # un tour par minute
REPRISE_MAX = 600             # après un redémarrage, la recherche a 10 min pour reprendre d'elle-même
RELANCE_ERREUR = 600          # collecte arrêtée sur une erreur : nouvel essai 10 min après
DUREE_MAX_RECHERCHE = 48 * 3600  # toute recherche s'arrête au bout de 48 h (règle du 20/11 : au-delà, Outlook gonfle
                                 # à 4 Go par page et le serveur gèle)
ETAPES = ("collecte", "tri", "programme", "envoi", "bloque", "fini")
MODELES = json.loads((Path(__file__).parent / "modeles.json").read_text(encoding="utf-8"))

# Réglages de la messagerie, fournis par main (préréglages Microsoft / Google).
reglages = None


def lire(uid):
    return (base.parametres_lire(uid) or {}).get("pilote")


def _ecrire(uid, p):
    d = base.parametres_lire(uid) or {}
    d["pilote"] = p
    base.parametres_ecrire(uid, d)


def _n(x):
    return f"{int(x):,}".replace(",", " ")


def fin_collecte(debut, maintenant=None):
    """5 h avant l'envoi ; si l'envoi est plus proche, la collecte garde 60 % du temps qui reste."""
    m = maintenant or time.time()
    return max(debut - MARGE_COLLECTE, m + (debut - m) * 0.6)


def message(uid):
    """Le message choisi dans la console, sinon le dernier message de l'école, sinon le message type dans sa langue."""
    m = (base.parametres_lire(uid) or {}).get("message") or {}
    if m.get("objet") and m.get("texte"):
        return m["objet"], m["texte"], m.get("langue") or "en"
    t = base.travail_lire(uid, "envoi")
    pr = (t or {}).get("params") or {}
    if pr.get("objet") and pr.get("texte"):
        return pr["objet"], pr["texte"], pr.get("langue") or "en"
    email = ((base.utilisateur_par_id(uid) or {}).get("email") or "").lower()
    langue = "fr" if email.endswith(".fr") else "en"
    objet, texte = MODELES[langue]
    return objet, texte, langue


def _passer(uid, p, etape, texte, niveau="info"):
    p["etape"] = etape
    p["maj"] = time.time()
    _ecrire(uid, p)
    base.journal_noter(uid, "envoi", "Pilote : " + texte, niveau)


def _horodatage(maj):
    try:
        return datetime.fromisoformat(str(maj)).timestamp()
    except ValueError:
        return 0.0


def _plage_pour(uid, debut):
    """L'heure d'envoi doit tomber dans la plage horaire du compte (sinon l'envoi attendrait le lendemain) :
    la plage est élargie s'il le faut."""
    r = reglages(uid)
    h = datetime.fromtimestamp(debut, ZoneInfo(config.FUSEAU)).hour
    if r["heure_debut"] <= h < r["heure_fin"]:
        return
    d = base.parametres_lire(uid) or {}
    for k in ("pack", "attente", "destinataires", "max_jour"):
        d.setdefault(k, r[k])
    d["heure_debut"], d["heure_fin"] = min(r["heure_debut"], h), max(r["heure_fin"], h + 1)
    base.parametres_ecrire(uid, d)
    base.journal_noter(uid, "envoi", f"Pilote : plage d'envoi élargie à {d['heure_debut']} h - {d['heure_fin']} h pour partir à {h} h.")


def _programmer_envoi(uid, debut):
    _plage_pour(uid, debut)
    objet, texte, langue = message(uid)
    travaux.lancer(uid, "envoi", {"objet": objet, "texte": texte, "langue": langue,
                                  "parametres": reglages(uid), "debut": float(debut)})


def _nouveau(etudiants=None):
    return {"etudiants": int(etudiants) if etudiants else None, "debut": None, "fin_collecte": None,
            "etape": "collecte", "facteur": 1.0, "blocages": 0, "recherche": False, "tri": False,
            "cree": time.time(), "maj": time.time()}


def demarrer_sans_date(uid):
    """Connexion d'un nouvel ambassadeur : l'extraction de l'annuaire démarre tout de suite, sans attendre la date."""
    p = _nouveau()
    _ecrire(uid, p)
    base.journal_noter(uid, "annuaire", "Pilote : extraction lancée dès la connexion (la date d'envoi viendra ensuite).")
    return p


def demarrer(uid, debut, etudiants=None):
    """Date d'envoi choisie (par l'ambassadeur ou depuis la console) : l'envoi est programmé tout de suite.
    Un pilote déjà en route garde où il en est (collecte, tri…) ; seule la date change."""
    p = lire(uid) or _nouveau(etudiants)
    p["debut"], p["fin_collecte"] = float(debut), fin_collecte(debut)
    if p.get("etape") == "fini":
        p.update({"etape": "collecte", "recherche": False, "tri": False})
    if travaux.en_cours(uid, "envoi"):
        travaux.programmer(uid, debut)  # déjà programmé : il part à la nouvelle heure
    else:
        _programmer_envoi(uid, debut)
    _ecrire(uid, p)
    base.journal_noter(uid, "envoi", f"Pilote lancé : envoi {travaux.quand_fr(debut)}. "
                                     f"Collecte de l'annuaire jusqu'à {travaux.quand_fr(p['fin_collecte'])} (5 h avant).")
    return p


def vue(uid):
    """Ce que voit l'ambassadeur : son choix (ou l'envoi déjà programmé pour lui)."""
    p = lire(uid)
    if p:
        return {"etudiants": p.get("etudiants"), "debut": p.get("debut"), "etape": p["etape"], "reconnecter": reconnecter(uid)}
    t = base.travail_lire(uid, "envoi")
    if t and t["statut"] == "attente" and (t["params"] or {}).get("debut"):
        return {"etudiants": None, "debut": t["params"]["debut"], "etape": "programme"}
    return {"etudiants": None, "debut": None, "etape": None}


def reconnecter(uid):
    """La messagerie a fermé la session du serveur : l'ambassadeur doit se reconnecter."""
    if not base.outlook_lire(uid):
        return True
    for ty in ("annuaire", "envoi"):
        t = base.travail_lire(uid, ty)
        if t and t["statut"] == "erreur" and "reconnect" in (t["message"] or "").lower():
            return True
    return False


def _contacts(uid):
    return max(base.extraits_compter(uid), base.destinataires_compter(uid) + base.exclus_compter(uid))


MODE_BLOCAGE = {"pack": 1, "destinataires": 90, "attente": 1430, "max_jour": 90}  # le rythme d'IESEG et de SKEMA


def _reduire(uid):
    """Après un blocage : le mode IESEG — 1 mail par jour de 90 étudiants en Cci, 90 par jour au plus."""
    r = reglages(uid)
    d = base.parametres_lire(uid) or {}
    for k in ("heure_debut", "heure_fin"):
        d[k] = r[k]
    d.update(MODE_BLOCAGE)
    d["taille_pack"] = 1
    base.parametres_ecrire(uid, d)
    return d


def tour(uid, p, maintenant=None):
    """Fait avancer le pilote d'un compte d'une étape au plus."""
    m = maintenant or time.time()
    e = p.get("etape")

    # La collecte s'arrête toujours 5 h avant l'envoi, quelle que soit l'étape (sur Gmail, l'envoi
    # attendrait sinon que la recherche libère le navigateur du compte).
    if e in ("tri", "programme", "envoi") and p.get("fin_collecte") and m >= p["fin_collecte"] and travaux.en_cours(uid, "annuaire"):
        travaux.arreter(uid, "annuaire")

    if e in ("collecte", "tri", "programme") and p.get("debut") and not travaux.en_cours(uid, "envoi") and base.outlook_lire(uid):
        t = base.travail_lire(uid, "envoi")
        if not (t and t["statut"] == "attente"):  # (« attente » : il repart tout seul après un redémarrage)
            _programmer_envoi(uid, p["debut"])
            base.journal_noter(uid, "envoi", "Pilote : envoi programmé " + travaux.quand_fr(p["debut"]) + ".")

    if e == "collecte":
        n = _contacts(uid)
        if n != p.get("contacts"):
            p["contacts"] = n
            _ecrire(uid, p)
        if _recherche_epuisee(uid, m):
            if travaux.en_cours(uid, "annuaire"):
                return  # limiter_recherche() l'arrête ; le tour suivant passe au tri
            return _passer(uid, p, "tri", f"collecte arrêtée au bout de 48 h : {_n(n)} contacts.")
        if p.get("fin_collecte") and m >= p["fin_collecte"]:
            if travaux.en_cours(uid, "annuaire"):
                travaux.arreter(uid, "annuaire")  # le tour suivant passe au tri
                return
            return _passer(uid, p, "tri", f"collecte terminée (5 h avant l'envoi) : {_n(n)} contacts.")
        if travaux.en_cours(uid, "annuaire"):
            return
        a = base.travail_lire(uid, "annuaire")
        if a and a["statut"] == "attente":
            return  # Outlook gelé : la recherche se relance toute seule
        relancer = False
        if a and a["statut"] == "en_cours":
            if m - _horodatage(a.get("maj")) < REPRISE_MAX:
                return  # redémarrage du serveur : la recherche reprend d'elle-même dans quelques instants
            relancer = True  # notée « en cours » mais arrêtée depuis longtemps : on la relance
        if p.get("recherche") and not relancer:
            if not (a and a["statut"] == "erreur"):
                return _passer(uid, p, "tri", f"collecte terminée (annuaire parcouru) : {_n(n)} contacts.")
            # Arrêtée sur une erreur (messagerie qui ne s'ouvre pas…) : on réessaie toutes les 10 min.
            if m - float(p.get("essai") or 0) < RELANCE_ERREUR:
                return
            p["echecs"] = int(p.get("echecs") or 0) + 1
        if not base.outlook_lire(uid):
            return  # plus de session : la console le signale
        base_recus = int(((a or {}).get("params") or {}).get("base_recus") or 0)
        travaux.lancer(uid, "annuaire", {"objectif": SANS_LIMITE, "base_recus": base_recus,
                                         "extraction": base.logique_lire(uid) is None})
        p["recherche"] = True
        p["essai"] = m
        if p.get("echecs"):
            return _passer(uid, p, "collecte", f"collecte relancée après une erreur (essai n° {p['echecs'] + 1}) : {(a or {}).get('message') or ''}",
                           "attention")
        return _passer(uid, p, "collecte", "collecte lancée, sans objectif, " + (f"jusqu'à {travaux.quand_fr(p['fin_collecte'])}."
                                                                                  if p.get("fin_collecte") else "en attendant la date d'envoi."))

    if e == "tri":
        if travaux.en_cours(uid, "annuaire") or travaux.en_cours(uid, "tri"):
            return
        if not p.get("tri") and base.extraits_compter(uid, non_tries=True):
            travaux.lancer(uid, "tri", {})
            p["tri"] = True
            return _passer(uid, p, "tri", "tri lancé : seuls les étudiants restent (personnel, profs, associations, anciens → Exclus).")
        return _passer(uid, p, "programme", f"tri terminé : {_n(base.destinataires_compter(uid, 'a_envoyer'))} étudiants à envoyer, "
                                            f"{_n(base.exclus_compter(uid))} exclus. " + (f"Envoi {travaux.quand_fr(p['debut'])}."
                                                                                          if p.get("debut") else "En attente de la date d'envoi."))

    if e == "programme":
        if p.get("debut") and m >= p["debut"]:
            return _passer(uid, p, "envoi", "l'envoi commence, par packs au maximum de la messagerie.")
        return

    if e == "envoi":
        t = base.travail_lire(uid, "envoi") or {}
        if travaux.en_cours(uid, "envoi"):
            return
        if t.get("statut") == "pause" and (t.get("progression") or {}).get("blocage"):
            p["blocages"] = int(p.get("blocages") or 0) + 1
            p["reprise_a"] = m + ATTENTE_BLOCAGE
            _reduire(uid)
            return _passer(uid, p, "bloque", f"boîte bloquée par la messagerie (blocage n° {p['blocages']}) : reprise "
                                             f"{travaux.quand_fr(p['reprise_a'])}, au rythme d'IESEG : 1 mail par jour "
                                             f"de 90 étudiants (90 par jour au plus).", "attention")
        if t.get("statut") == "fini":
            return _passer(uid, p, "fini", f"envoi terminé : {_n(base.destinataires_compter(uid, 'recus'))} étudiants ont reçu le message.")
        return

    if e == "bloque":
        if m < float(p.get("reprise_a") or 0):
            return
        if not travaux.en_cours(uid, "envoi"):
            t = base.travail_lire(uid, "envoi")
            if not t:
                return
            params = dict(t["params"])
            params["parametres"] = reglages(uid)
            params.pop("reprise_a", None)
            params.pop("pack_debut", None)
            travaux.lancer(uid, "envoi", params)
        return _passer(uid, p, "envoi", "envoi repris après 24 h, au rythme d'IESEG : 1 mail par jour de 90 étudiants.")


def _recherche_epuisee(uid, maintenant=None):
    depuis = (base.parametres_lire(uid) or {}).get("recherche_depuis")
    return bool(depuis) and (maintenant or time.time()) - float(depuis) >= DUREE_MAX_RECHERCHE


def limiter_recherche(uid, maintenant=None):
    """Toute recherche (pilote ou lancée à la main) s'arrête au bout de 48 h. Le compteur part du
    premier lancement ; pendant la collecte du pilote, les relances après une erreur ne le remettent
    pas à zéro. Il repart à zéro au lancement suivant une fois la recherche finie."""
    m = maintenant or time.time()
    d = base.parametres_lire(uid) or {}
    depuis = d.get("recherche_depuis")
    if not travaux.en_cours(uid, "annuaire"):
        if depuis and (d.get("pilote") or {}).get("etape") != "collecte":
            d.pop("recherche_depuis", None)
            base.parametres_ecrire(uid, d)
        return
    if not depuis:
        d["recherche_depuis"] = m
        base.parametres_ecrire(uid, d)
        return
    if m - float(depuis) >= DUREE_MAX_RECHERCHE and travaux.arreter(uid, "annuaire"):
        base.journal_noter(uid, "annuaire", "Recherche arrêtée automatiquement au bout de 48 h.", "attention")


VERIF_GMAIL = 3 * 3600  # Google : la session est vérifiée (et gardée vivante) toutes les 3 h
_verifs = {}


def _verifier_gmail(uid):
    """Session Google rouverte toutes les 3 h, jamais pendant qu'une tâche l'utilise : elle reste vivante,
    et si Google l'a fermée on le sait des heures avant l'envoi (console + « Reconnectez-vous »)."""
    from . import navigateur
    if not navigateur.profil_gmail(uid) or not base.outlook_lire(uid) or navigateur.verrou_profil(uid).locked():
        return
    t = _verifs.get(uid)
    if t is not None and not t.done():
        return
    vu = (base.outlook_infos(uid) or {}).get("verifie") or ""
    try:
        age = time.time() - datetime.fromisoformat(vu).timestamp()
    except ValueError:
        age = VERIF_GMAIL
    if age >= VERIF_GMAIL:
        _verifs[uid] = asyncio.get_running_loop().create_task(navigateur.verifier(uid))


def _demarrer_si_nouveau(u):
    """Un ambassadeur connecté, tout neuf (ni pilote, ni recherche, ni envoi) : son extraction démarre.
    Les écoles réglées à la main avant le pilote ne sont jamais touchées."""
    if u.get("role") != "ambassadeur" or not u.get("actif") or not u.get("email") or lire(u["id"]):
        return
    if not base.outlook_lire(u["id"]) or base.travail_lire(u["id"], "annuaire") or base.travail_lire(u["id"], "envoi"):
        return
    demarrer_sans_date(u["id"])


async def boucle():
    """Un tour par minute pour chaque compte dont le pilote n'a pas fini."""
    while True:
        try:
            for u in base.utilisateurs():
                try:
                    _demarrer_si_nouveau(u)
                except Exception as e:
                    print(f"[pilote] démarrage compte {u['id']} : {e!r}", flush=True)
                try:
                    limiter_recherche(u["id"])
                except Exception as e:
                    print(f"[pilote] limite 48 h compte {u['id']} : {e!r}", flush=True)
                try:
                    _verifier_gmail(u["id"])
                except Exception as e:
                    print(f"[pilote] vérification Gmail compte {u['id']} : {e!r}", flush=True)
                p = lire(u["id"])
                if p and p.get("etape") not in (None, "fini"):
                    try:
                        tour(u["id"], p)
                    except Exception as e:  # un compte en souci ne bloque pas les autres
                        print(f"[pilote] compte {u['id']} : {e!r}", flush=True)
        except Exception as e:
            print(f"[pilote] {e!r}", flush=True)
        await asyncio.sleep(PAS)
