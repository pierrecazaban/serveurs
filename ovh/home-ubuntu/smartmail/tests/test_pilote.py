"""Le pilote automatique : collecte (sans objectif, jusqu'à 5 h avant l'envoi), tri, envoi programmé,
et après un blocage : 24 h d'attente puis le mode IESEG (90 par jour), à chaque fois."""
import time

import pytest

from app import base, coffre, main, pilote, travaux


class FauxTravaux:
    """Les travaux, sans navigateur : on note ce qui est lancé, et on décide de ce qui tourne."""
    def __init__(self, monkeypatch):
        self.lances, self.tournent, self.arretes = [], set(), []
        monkeypatch.setattr(travaux, "lancer", lambda uid, ty, params: (self.lances.append((ty, params)), self.tournent.add(ty)))
        monkeypatch.setattr(travaux, "en_cours", lambda uid, ty: ty in self.tournent)
        monkeypatch.setattr(travaux, "arreter", lambda uid, ty: (self.arretes.append(ty), self.tournent.discard(ty)))
        monkeypatch.setattr(travaux, "programmer", lambda uid, debut: True)
        pilote.reglages = main._parametres


@pytest.fixture
def compte(monkeypatch):
    u, _ = base.compte_outlook("ana@ecole.fr")
    base.outlook_ecrire(u["id"], "ana@ecole.fr", coffre.fermer("{}"))
    return u["id"], FauxTravaux(monkeypatch)


def test_le_pilote_enchaine_tout(compte):
    uid, ft = compte
    debut = time.time() + 2 * 86400
    p = pilote.demarrer(uid, debut)
    # L'envoi est programmé tout de suite, en français (adresse .fr), au maximum d'Outlook.
    ty, params = ft.lances[0]
    assert ty == "envoi" and params["debut"] == debut and params["langue"] == "fr"
    assert "the-ai-certification.com/ecole" in params["texte"] and params["parametres"]["max_jour"] == 9995
    assert "objectif" not in p and abs(p["fin_collecte"] - (debut - 5 * 3600)) < 1

    # 1. Collecte : lancée une seule fois, sans objectif ; beaucoup de contacts ne l'arrêtent pas, seule l'heure compte.
    pilote.tour(uid, pilote.lire(uid))
    assert ft.lances[-1][0] == "annuaire" and ft.lances[-1][1]["objectif"] >= 10_000_000 and ft.lances[-1][1]["extraction"]
    base.extraits_ajouter(uid, [{"adresse": f"e{i}@ecole.fr", "nom": ""} for i in range(500)])
    pilote.tour(uid, pilote.lire(uid))
    assert len(ft.lances) == 2 and pilote.lire(uid)["etape"] == "collecte" and not ft.arretes
    pilote.tour(uid, pilote.lire(uid), maintenant=debut - 5 * 3600)
    assert ft.arretes == ["annuaire"]  # 5 h avant l'envoi : la recherche s'arrête
    pilote.tour(uid, pilote.lire(uid), maintenant=debut - 5 * 3600 + 60)
    assert pilote.lire(uid)["etape"] == "tri"

    # 2. Tri : lancé sur les contacts pas encore triés, puis on passe à l'envoi programmé.
    pilote.tour(uid, pilote.lire(uid), maintenant=debut - 5 * 3600 + 120)
    assert ft.lances[-1][0] == "tri"
    ft.tournent.discard("tri")
    pilote.tour(uid, pilote.lire(uid), maintenant=debut - 5 * 3600 + 180)
    assert pilote.lire(uid)["etape"] == "programme"

    # 3. À l'heure : l'envoi.
    pilote.tour(uid, pilote.lire(uid), maintenant=debut + 1)
    assert pilote.lire(uid)["etape"] == "envoi"

    # 4. Blocage : 24 h d'attente, puis le mode IESEG (1 mail de 90 par jour).
    ft.tournent.discard("envoi")
    base.travail_ecrire(uid, "envoi", "pause", {"objet": "o", "texte": "t", "langue": "fr"}, {"blocage": True}, "bloqué")
    pilote.tour(uid, pilote.lire(uid), maintenant=debut + 100)
    p = pilote.lire(uid)
    assert p["etape"] == "bloque" and p["blocages"] == 1 and abs(p["reprise_a"] - (debut + 100 + 86400)) < 1
    r = main._parametres(uid)
    assert (r["pack"], r["destinataires"], r["attente"], r["max_jour"]) == (1, 90, 1430, 90)
    n = len(ft.lances)
    pilote.tour(uid, p, maintenant=debut + 3600)
    assert len(ft.lances) == n  # pas avant 24 h
    pilote.tour(uid, pilote.lire(uid), maintenant=debut + 100 + 86400)
    assert ft.lances[-1][0] == "envoi" and ft.lances[-1][1]["parametres"]["max_jour"] == 90 and ft.lances[-1][1]["parametres"]["destinataires"] == 90
    assert pilote.lire(uid)["etape"] == "envoi"

    # Encore bloqué : encore 24 h, toujours 90 par jour (jamais moins).
    ft.tournent.discard("envoi")
    pilote.tour(uid, pilote.lire(uid), maintenant=debut + 2 * 86400)
    assert pilote.lire(uid)["blocages"] == 2 and main._parametres(uid)["max_jour"] == 90

    # Fin.
    pilote.tour(uid, pilote.lire(uid), maintenant=debut + 4 * 86400)
    ft.tournent.discard("envoi")
    base.travail_ecrire(uid, "envoi", "fini", {}, {}, "fini")
    pilote.tour(uid, pilote.lire(uid), maintenant=debut + 5 * 86400)
    assert pilote.lire(uid)["etape"] == "fini"


def test_collecte_coupee_5h_avant_l_envoi(compte):
    uid, ft = compte
    debut = time.time() + 86400
    pilote.demarrer(uid, debut)
    pilote.tour(uid, pilote.lire(uid))  # collecte lancée
    pilote.tour(uid, pilote.lire(uid), maintenant=debut - 5 * 3600 + 1)
    assert ft.arretes == ["annuaire"]
    pilote.tour(uid, pilote.lire(uid), maintenant=debut - 5 * 3600 + 60)
    assert pilote.lire(uid)["etape"] == "tri"


def test_le_pilote_garde_le_message_de_l_ecole_et_les_reglages(compte, client=None):
    uid, ft = compte
    base.travail_ecrire(uid, "envoi", "fini", {"objet": "Objet de l'école", "texte": "Texte", "langue": "en"}, {}, "")
    pilote.demarrer(uid, time.time() + 86400)
    assert ft.lances[0][1]["objet"] == "Objet de l'école" and ft.lances[0][1]["langue"] == "en"


def test_le_pilote_programme_l_envoi_s_il_manque(compte):
    """Pilote écrit sans envoi programmé (ex. ancienne version) : le premier tour le programme."""
    uid, ft = compte
    debut = time.time() + 86400
    d = base.parametres_lire(uid) or {}
    d["pilote"] = {"etudiants": None, "debut": debut, "fin_collecte": pilote.fin_collecte(debut),
                   "etape": "collecte", "facteur": 1.0, "blocages": 0, "recherche": False, "tri": False}
    base.parametres_ecrire(uid, d)
    pilote.tour(uid, pilote.lire(uid))
    assert [ty for ty, _ in ft.lances] == ["envoi", "annuaire"] and ft.lances[0][1]["debut"] == debut


def test_collecte_en_erreur_reessayee(compte):
    """La messagerie ne s'ouvre pas : le pilote ne passe pas au tri avec 0 contact, il réessaie toutes les 10 min."""
    uid, ft = compte
    debut = time.time() + 2 * 86400
    pilote.demarrer(uid, debut)
    m = time.time()
    pilote.tour(uid, pilote.lire(uid), maintenant=m)
    ft.tournent.discard("annuaire")
    base.travail_ecrire(uid, "annuaire", "erreur", {}, {}, "Gmail ne s'est pas ouvert.")
    pilote.tour(uid, pilote.lire(uid), maintenant=m + 60)
    assert pilote.lire(uid)["etape"] == "collecte" and len(ft.lances) == 2
    pilote.tour(uid, pilote.lire(uid), maintenant=m + 601)
    assert pilote.lire(uid)["etape"] == "collecte" and ft.lances[-1][0] == "annuaire" and len(ft.lances) == 3


def test_redemarrage_pendant_la_collecte(compte):
    """Redémarrage du serveur : la recherche, notée « en cours », reprend d'elle-même — le pilote attend
    au lieu de passer au tri. Arrêtée depuis longtemps sans le dire : il la relance."""
    uid, ft = compte
    debut = time.time() + 2 * 86400
    pilote.demarrer(uid, debut)
    m = time.time()
    pilote.tour(uid, pilote.lire(uid), maintenant=m)  # collecte lancée
    ft.tournent.discard("annuaire")
    base.travail_ecrire(uid, "annuaire", "en_cours", {}, {}, "Lecture de l'annuaire…")
    pilote.tour(uid, pilote.lire(uid), maintenant=time.time() + 60)
    assert pilote.lire(uid)["etape"] == "collecte" and len(ft.lances) == 2
    pilote.tour(uid, pilote.lire(uid), maintenant=time.time() + 1200)
    assert pilote.lire(uid)["etape"] == "collecte" and ft.lances[-1][0] == "annuaire" and len(ft.lances) == 3


def test_collecte_coupee_meme_apres_l_etape(compte):
    """Pilote déjà « programmé » mais recherche encore en route : coupée 5 h avant l'envoi."""
    uid, ft = compte
    debut = time.time() + 86400
    pilote.demarrer(uid, debut)
    p = pilote.lire(uid); p["etape"] = "programme"
    ft.tournent.add("annuaire")
    pilote.tour(uid, p, maintenant=debut - 5 * 3600 + 30)
    assert ft.arretes == ["annuaire"]


def test_plage_elargie_pour_l_heure_d_envoi(compte):
    """Envoi à 20 h alors que la plage s'arrête à 20 h : la plage est élargie (sinon il partirait le lendemain)."""
    import datetime, zoneinfo
    uid, ft = compte
    d = base.parametres_lire(uid) or {}
    d.update({"pack": 1, "attente": 120, "destinataires": 495, "max_jour": 2995, "heure_debut": 8, "heure_fin": 20})
    base.parametres_ecrire(uid, d)
    j = (datetime.datetime.now(zoneinfo.ZoneInfo("Europe/Paris")) + datetime.timedelta(days=2)).replace(hour=20, minute=0, second=0, microsecond=0)
    pilote.demarrer(uid, j.timestamp())
    r = main._parametres(uid)
    assert r["heure_debut"] == 8 and r["heure_fin"] == 21 and ft.lances[0][1]["parametres"]["heure_fin"] == 21


def test_extraction_des_la_connexion_puis_date(compte):
    """Nouvel ambassadeur connecté : l'extraction démarre tout de suite, sans date ni envoi. La date arrive
    ensuite : la collecte continue là où elle en est, et l'envoi est programmé."""
    uid, ft = compte
    u = base.utilisateur_par_id(uid)
    pilote._demarrer_si_nouveau(u)
    p = pilote.lire(uid)
    assert p and p["etape"] == "collecte" and p["debut"] is None
    pilote.tour(uid, p)
    assert [ty for ty, _ in ft.lances] == ["annuaire"]  # pas d'envoi sans date
    pilote.tour(uid, pilote.lire(uid), maintenant=time.time() + 30 * 86400)
    assert pilote.lire(uid)["etape"] == "collecte" and ft.arretes == []  # sans date : jamais coupée
    debut = time.time() + 2 * 86400
    pilote.demarrer(uid, debut)
    p = pilote.lire(uid)
    assert p["recherche"] and p["etape"] == "collecte" and abs(p["fin_collecte"] - (debut - 5 * 3600)) < 1
    assert ft.lances[-1][0] == "envoi" and ft.lances[-1][1]["debut"] == debut
    # Une école déjà réglée à la main (recherche ou envoi existants) n'est jamais touchée.
    v, _ = base.compte_outlook("ancien@ecole.fr")
    base.outlook_ecrire(v["id"], "ancien@ecole.fr", coffre.fermer("{}"))
    base.travail_ecrire(v["id"], "envoi", "attente", {"debut": debut}, {}, "")
    pilote._demarrer_si_nouveau(base.utilisateur_par_id(v["id"]))
    assert pilote.lire(v["id"]) is None
