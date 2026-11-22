"""Connexion en direct : la vraie page de connexion (ici un faux Microsoft fidèle)
affichée dans l'app, pilotée par les touchers et la saisie de la personne, via le
flux WebSocket. On vérifie : images reçues, clavier adapté au champ, connexion
réussie, compte confirmé par Outlook, reprise après une coupure, et refus quand
on ne peut pas savoir qui est connecté."""

import time

import pytest
from fastapi.testclient import TestClient

from app import base, config, direct, navigateur
from app.main import app
from faux_microsoft import FauxMicrosoft


@pytest.fixture(scope="module")
def faux():
    f = FauxMicrosoft().demarrer()
    yield f
    f.arreter()


@pytest.fixture
def client(faux, monkeypatch):
    faux.comptes.clear(); faux.sessions.clear(); faux.approuvees.clear(); faux.essais_mdp.clear()
    faux.google.clear(); faux.sessions_google.clear()
    faux.sans_identite = faux.sans_login = faux.gmail_sans_compte = False
    direct._essais.clear()
    monkeypatch.setattr(config, "OUTLOOK_URL", faux.url + "/mail/")
    monkeypatch.setattr(config, "OUTLOOK_ARRIVEE", [faux.url + "/mail"])
    monkeypatch.setattr(config, "GMAIL_URL", faux.url + "/gmail/mail/u/0/")
    monkeypatch.setattr(config, "GMAIL_ARRIVEE", [faux.url + "/gmail/mail/"])
    monkeypatch.setattr(config, "DEMO", False)
    monkeypatch.setattr(config, "ADMINS", [])
    with TestClient(app) as c:
        yield c


async def _centre(e, selecteur):
    b = await e.page.locator(selecteur).first.bounding_box()
    return {"x": b["x"] + b["width"] / 2, "y": b["y"] + b["height"] / 2}


def attendre(predicat, delai=25):
    fin = time.time() + delai
    while time.time() < fin:
        if predicat():
            return True
        time.sleep(0.2)
    raise AssertionError("délai dépassé")


def toucher(client, ws, e, selecteur):
    attendre(lambda: e.page is not None)
    attendre(lambda: client.portal.call(e.page.locator(selecteur).count) > 0)
    ws.send_json({"t": "clic", **client.portal.call(_centre, e, selecteur)})


def lire_jusqu_a(ws, condition, maximum=400):
    for _ in range(maximum):
        m = ws.receive_json()
        if condition(m):
            return m
    raise AssertionError("message attendu jamais reçu")


def se_connecter(client, ws, e, adresse, mdp):
    toucher(client, ws, e, "input[name=loginfmt]")
    ws.send_json({"t": "texte", "s": adresse})
    ws.send_json({"t": "touche", "k": "Enter"})
    attendre(lambda: client.portal.call(e.page.locator("input[name=passwd]:not(.moveOffScreen)").count) > 0)
    toucher(client, ws, e, "input[name=passwd]:not(.moveOffScreen)")
    ws.send_json({"t": "texte", "s": mdp})
    ws.send_json({"t": "touche", "k": "Enter"})
    attendre(lambda: client.portal.call(e.page.locator("input[name=DontShowAgain]").count) > 0)
    toucher(client, ws, e, "input[name=DontShowAgain]")
    toucher(client, ws, e, "#idSIButton9")


def test_connexion_en_direct_comme_sur_outlook(client, faux):
    faux.ajouter("lea@ecole.fr", "Secret-1")
    v = client.post("/v1/direct", json={"largeur": 390, "hauteur": 700, "dpr": 2}).json()
    e = direct.trouver(v["id"])
    with client.websocket_connect(f"/v1/direct/{v['id']}/flux") as ws:
        img = lire_jusqu_a(ws, lambda m: m.get("t") == "image")
        assert img["w"] == 390 and img["h"] == 700 and len(img["d"]) > 1000  # la page, en image
        toucher(client, ws, e, "input[name=loginfmt]")
        clavier = lire_jusqu_a(ws, lambda m: m.get("t") == "clavier" and m.get("champ"))
        assert clavier["champ"]["type"] == "email"  # l'app ouvre le clavier d'adresse
        ws.send_json({"t": "texte", "s": "lea@ecole.fr"})
        ws.send_json({"t": "touche", "k": "Enter"})
        attendre(lambda: client.portal.call(e.page.locator("input[name=passwd]:not(.moveOffScreen)").count) > 0)
        toucher(client, ws, e, "input[name=passwd]:not(.moveOffScreen)")
        clavier = lire_jusqu_a(ws, lambda m: m.get("t") == "clavier" and m.get("champ") and m["champ"]["type"] == "password")
        ws.send_json({"t": "texte", "s": "Secret-1"})
        ws.send_json({"t": "touche", "k": "Enter"})
        attendre(lambda: client.portal.call(e.page.locator("input[name=DontShowAgain]").count) > 0)
        toucher(client, ws, e, "input[name=DontShowAgain]")
        toucher(client, ws, e, "#idSIButton9")
        lire_jusqu_a(ws, lambda m: m.get("t") == "etat" and m.get("etat") == "reussie", maximum=2000)
    r = client.post(f"/v1/direct/{v['id']}/terminer")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["email"] == "lea@ecole.fr" and j["role"] == "ambassadeur"
    assert "sm_session" in r.headers.get("set-cookie", "")  # restera connecté
    assert client.get("/v1/compte", headers={"Authorization": "Bearer " + j["code"]}).json()["outlook"]["connecte"] is True
    assert client.post(f"/v1/direct/{v['id']}/terminer").status_code == 409  # une seule fois
    # Jamais l'adresse d'un expéditeur glissée dans les données d'Outlook.
    assert base.utilisateur_par_email("pirate@ailleurs.fr") is None


def test_coupure_puis_rebranchement(client, faux):
    """Passage dans Authenticator sur iPhone : l'app perd le flux puis se rebranche."""
    faux.ajouter("tom@ecole.fr", "Mdp-2")
    v = client.post("/v1/direct", json={"largeur": 1024, "hauteur": 768, "dpr": 1}).json()
    e = direct.trouver(v["id"])
    with client.websocket_connect(f"/v1/direct/{v['id']}/flux") as ws:
        lire_jusqu_a(ws, lambda m: m.get("t") == "image")
        toucher(client, ws, e, "input[name=loginfmt]")
        ws.send_json({"t": "texte", "s": "tom@ecole.fr"})
        ws.send_json({"t": "touche", "k": "Enter"})
        attendre(lambda: client.portal.call(e.page.locator("input[name=passwd]:not(.moveOffScreen)").count) > 0)
    time.sleep(1)  # flux coupé
    assert client.get(f"/v1/direct/{v['id']}").json()["etat"] == "ouvert"  # la page attend toujours
    with client.websocket_connect(f"/v1/direct/{v['id']}/flux") as ws:
        lire_jusqu_a(ws, lambda m: m.get("t") == "image")  # la dernière image revient tout de suite
        toucher(client, ws, e, "input[name=passwd]:not(.moveOffScreen)")
        ws.send_json({"t": "texte", "s": "Mdp-2"})
        ws.send_json({"t": "touche", "k": "Enter"})
        attendre(lambda: client.portal.call(e.page.locator("input[name=DontShowAgain]").count) > 0)
        toucher(client, ws, e, "#idSIButton9")
        lire_jusqu_a(ws, lambda m: m.get("t") == "etat" and m.get("etat") == "reussie", maximum=2000)
    assert client.post(f"/v1/direct/{v['id']}/terminer").json()["email"] == "tom@ecole.fr"


def test_sans_configuration_outlook_l_adresse_du_mot_de_passe_accepte(client, faux):
    faux.sans_identite = True
    faux.ajouter("lea@ecole.fr", "Secret-1")
    v = client.post("/v1/direct", json={"largeur": 390, "hauteur": 700}).json()
    e = direct.trouver(v["id"])
    with client.websocket_connect(f"/v1/direct/{v['id']}/flux") as ws:
        lire_jusqu_a(ws, lambda m: m.get("t") == "image")
        se_connecter(client, ws, e, "lea@ecole.fr", "Secret-1")
        lire_jusqu_a(ws, lambda m: m.get("t") == "etat" and m.get("etat") == "reussie", maximum=3000)
    assert client.post(f"/v1/direct/{v['id']}/terminer").json()["email"] == "lea@ecole.fr"


def test_compte_inconnaissable_refuse(client, faux):
    """Ni configuration d'Outlook, ni adresse envoyée avec le mot de passe : on ne
    devine pas, on refuse."""
    faux.sans_identite = faux.sans_login = True
    faux.ajouter("lea@ecole.fr", "Secret-1")
    v = client.post("/v1/direct", json={"largeur": 390, "hauteur": 700}).json()
    e = direct.trouver(v["id"])
    with client.websocket_connect(f"/v1/direct/{v['id']}/flux") as ws:
        lire_jusqu_a(ws, lambda m: m.get("t") == "image")
        se_connecter(client, ws, e, "lea@ecole.fr", "Secret-1")
        m = lire_jusqu_a(ws, lambda m: m.get("t") == "etat" and m.get("etat") == "echec", maximum=4000)
    assert "confirmer votre adresse" in m["message"]
    assert base.utilisateur_par_email("lea@ecole.fr") is None


def test_gestes_bornes_et_annulation(client, faux):
    v = client.post("/v1/direct", json={"largeur": 390, "hauteur": 700}).json()
    e = direct.trouver(v["id"])
    with client.websocket_connect(f"/v1/direct/{v['id']}/flux") as ws:
        lire_jusqu_a(ws, lambda m: m.get("t") == "image")
        ws.send_json({"t": "touche", "k": "Meta+R"})  # touche hors liste : ignorée
        ws.send_json({"t": "clic", "x": 99999, "y": -50})  # ramené dans la page
        ws.send_json({"t": "inconnu"})
    assert client.delete(f"/v1/direct/{v['id']}").json() == {"ok": True}
    assert client.get(f"/v1/direct/{v['id']}").status_code == 404
    with client.websocket_connect(f"/v1/direct/{v['id']}/flux") as ws:
        assert ws.receive_json()["etat"] == "echec"
    assert client.post("/v1/direct", json={"largeur": 10, "hauteur": 700}).status_code == 422


def test_cle_d_acces_non_prise_passee_automatiquement(client, faux):
    """Comme un compte IESEG : Microsoft dit que le navigateur n'a pas de clé d'accès.
    Le serveur touche « Annuler » tout seul ; l'étudiant choisit son mot de passe."""
    faux.ajouter("pierre@ieseg.fr", "Ieseg-1", cle_non_prise=True)
    v = client.post("/v1/direct", json={"largeur": 390, "hauteur": 700}).json()
    e = direct.trouver(v["id"])
    with client.websocket_connect(f"/v1/direct/{v['id']}/flux") as ws:
        lire_jusqu_a(ws, lambda m: m.get("t") == "image")
        toucher(client, ws, e, "input[name=loginfmt]")
        ws.send_json({"t": "texte", "s": "pierre@ieseg.fr"})
        ws.send_json({"t": "touche", "k": "Enter"})
        # Sans rien toucher : on arrive sur le choix de la méthode.
        attendre(lambda: client.portal.call(e.page.locator("#choix-mdp").count) > 0)
        toucher(client, ws, e, "#choix-mdp")
        attendre(lambda: client.portal.call(e.page.locator("input[name=passwd]:not(.moveOffScreen)").count) > 0)
        toucher(client, ws, e, "input[name=passwd]:not(.moveOffScreen)")
        ws.send_json({"t": "texte", "s": "Ieseg-1"})
        ws.send_json({"t": "touche", "k": "Enter"})
        attendre(lambda: client.portal.call(e.page.locator("input[name=DontShowAgain]").count) > 0)
        toucher(client, ws, e, "#idSIButton9")
        lire_jusqu_a(ws, lambda m: m.get("t") == "etat" and m.get("etat") == "reussie", maximum=3000)
    assert client.post(f"/v1/direct/{v['id']}/terminer").json()["email"] == "pierre@ieseg.fr"


def _gmail(client, ws, e, adresse, mdp):
    toucher(client, ws, e, "#identifierId")
    ws.send_json({"t": "texte", "s": adresse})
    ws.send_json({"t": "touche", "k": "Enter"})
    attendre(lambda: client.portal.call(e.page.locator("input[name=Passwd]").count) > 0)
    toucher(client, ws, e, "input[name=Passwd]")
    ws.send_json({"t": "texte", "s": mdp})
    ws.send_json({"t": "touche", "k": "Enter"})


def test_connexion_gmail_en_direct(client, faux):
    """Comme pour Outlook, mais sur la page Google : le compte est celui que Gmail
    affiche, jamais une adresse lue dans les messages."""
    faux.google["lea@ecole.fr"] = "Google-1"
    v = client.post("/v1/direct", json={"largeur": 390, "hauteur": 700, "dpr": 2, "messagerie": "gmail"}).json()
    e = direct.trouver(v["id"])
    assert e.messagerie == "gmail"
    with client.websocket_connect(f"/v1/direct/{v['id']}/flux") as ws:
        lire_jusqu_a(ws, lambda m: m.get("t") == "image")
        _gmail(client, ws, e, "lea@ecole.fr", "Google-1")
        lire_jusqu_a(ws, lambda m: m.get("t") == "etat" and m.get("etat") == "reussie", maximum=3000)
    j = client.post(f"/v1/direct/{v['id']}/terminer").json()
    assert j["email"] == "lea@ecole.fr"
    c = client.get("/v1/compte", headers={"Authorization": "Bearer " + j["code"]}).json()
    assert c["outlook"]["connecte"] is True and c["outlook"]["messagerie"] == "gmail"
    assert base.utilisateur_par_email("pirate@ailleurs.fr") is None
    # Google : la connexion devient LE profil de navigateur de cet ambassadeur (ses tâches s'y rouvriront).
    u = base.utilisateur_par_email("lea@ecole.fr")
    attendre(lambda: navigateur.profil_gmail(u["id"]))
    assert not list(navigateur.profils().glob("connexion-*"))


def test_gmail_sans_compte_affiche_refuse(client, faux):
    faux.google["lea@ecole.fr"] = "Google-1"
    faux.gmail_sans_compte = True
    v = client.post("/v1/direct", json={"largeur": 1024, "hauteur": 768, "messagerie": "gmail"}).json()
    e = direct.trouver(v["id"])
    with client.websocket_connect(f"/v1/direct/{v['id']}/flux") as ws:
        lire_jusqu_a(ws, lambda m: m.get("t") == "image")
        _gmail(client, ws, e, "lea@ecole.fr", "Google-1")
        m = lire_jusqu_a(ws, lambda m: m.get("t") == "etat" and m.get("etat") == "echec", maximum=4000)
    assert "confirmer votre adresse" in m["message"]
    assert base.utilisateur_par_email("lea@ecole.fr") is None and base.utilisateur_par_email("pirate@ailleurs.fr") is None


def test_session_gmail_rouverte_par_le_serveur(client, faux):
    """La session Gmail vit sur le serveur : l'entretien la rouvre sans la perdre."""
    faux.google["tom@ecole.fr"] = "Google-2"
    v = client.post("/v1/direct", json={"largeur": 1024, "hauteur": 768, "messagerie": "gmail"}).json()
    e = direct.trouver(v["id"])
    with client.websocket_connect(f"/v1/direct/{v['id']}/flux") as ws:
        lire_jusqu_a(ws, lambda m: m.get("t") == "image")
        _gmail(client, ws, e, "tom@ecole.fr", "Google-2")
        lire_jusqu_a(ws, lambda m: m.get("t") == "etat" and m.get("etat") == "reussie", maximum=3000)
    client.post(f"/v1/direct/{v['id']}/terminer")
    u = base.utilisateur_par_email("tom@ecole.fr")
    assert client.portal.call(navigateur.verifier, u["id"]) is True
    assert base.outlook_lire(u["id"])["messagerie"] == "gmail"
    faux.sessions_google.clear()  # Google a fermé la session : on l'oublie, il faudra se reconnecter
    assert client.portal.call(navigateur.verifier, u["id"]) is False
