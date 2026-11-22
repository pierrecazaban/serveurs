"""Une session n'est jamais perdue par le serveur ; elle est renouvelée toutes les 6 h et contrôlée
avant chaque envoi programmé."""
import json
import time
from datetime import timedelta

from app import base, coffre, navigateur


def _compte(adresse="amb@ecole.fr"):
    u, _ = base.compte_outlook(adresse)
    base.outlook_ecrire(u["id"], adresse, coffre.fermer('{"v": 1}'))
    return u["id"]


def test_effacement_et_remplacement_archives_puis_restaurables():
    uid = _compte()
    base.outlook_oublier(uid)                       # ex. panne prise pour une expiration
    assert base.outlook_lire(uid) is None
    arch = base.sessions_archivees(uid)
    assert len(arch) == 1 and "effacée" in arch[0][1]
    assert base.session_restaurer(uid, arch[0][0])
    assert json.loads(coffre.ouvrir(base.outlook_lire(uid)["etat"])) == {"v": 1}
    base.outlook_ecrire(uid, "amb@ecole.fr", coffre.fermer('{"v": 2}'))   # reconnexion
    assert any("nouvelle connexion" in r for _, r, _ in base.sessions_archivees(uid))


def test_historique_limite_et_renouvellement_espace():
    uid = _compte("b@ecole.fr")
    for i in range(15):
        base.outlook_ecrire(uid, "b@ecole.fr", coffre.fermer(json.dumps({"v": i})))
    assert len(base.sessions_archivees(uid)) == base.ARCHIVES_MAX
    n = len(base.sessions_archivees(uid))
    base.outlook_rafraichir(uid, coffre.fermer('{"v": 99}'))  # archive « renouvelée » : au plus toutes les 6 h
    base.outlook_rafraichir(uid, coffre.fermer('{"v": 100}'))
    assert sum(1 for _, r, _ in base.sessions_archivees(uid) if r == "renouvelée") <= 1 and len(base.sessions_archivees(uid)) == n


def test_comptes_a_controler():
    a, b = _compte("c@ecole.fr"), _compte("d@ecole.fr")
    vieux = (base.maintenant() - timedelta(hours=7)).isoformat()
    with base._verrou:
        base.cnx().execute("UPDATE outlook SET verifie = ? WHERE utilisateur_id = ?", (vieux, a))
    debut = time.time() + 2 * 3600  # envoi dans 2 h : le contrôle « 3 h avant » est dû
    base.travail_ecrire(b, "envoi", "attente", {"debut": debut}, {}, "")
    navigateur._controles_faits.clear()
    uids = dict(navigateur._a_controler(time.time()))
    assert a in uids and "6 h" in uids[a]
    assert b in uids and "avant l'envoi" in uids[b]
    assert b not in dict(navigateur._a_controler(time.time()))  # une seule fois par échéance
