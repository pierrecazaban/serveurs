"""Connexion avec le compte Outlook (le serveur se connecte à Outlook web dans un
vrai navigateur), session Outlook gardée sur le serveur, sessions d'appareil
verrouillées sur leur compte, rôles ambassadeur / administrateur."""

import asyncio
import json
import os
import stat
import time

import pytest
from fastapi.testclient import TestClient

from app import base, coffre, config, navigateur
from app.main import app
from faux_microsoft import FauxMicrosoft


@pytest.fixture(scope="module")
def faux():
    f = FauxMicrosoft().demarrer()
    yield f
    f.arreter()


@pytest.fixture
def client(faux, monkeypatch):
    faux.comptes.clear(); faux.sessions.clear(); faux.approuvees.clear(); faux.refusees.clear(); faux.essais_mdp.clear()
    navigateur._essais.clear()
    monkeypatch.setattr(config, "OUTLOOK_URL", faux.url + "/mail/")
    monkeypatch.setattr(config, "OUTLOOK_ARRIVEE", [faux.url + "/mail"])
    monkeypatch.setattr(config, "CONNEXION_DELAI", 30)
    monkeypatch.setattr(config, "DEMO", False)
    monkeypatch.setattr(config, "ADMINS", [])
    monkeypatch.setattr(config, "DOMAINES", [])
    with TestClient(app) as c:
        yield c


def suivre(client, cid, jusqu_a=("reussie", "echec"), delai=25):
    fin = time.time() + delai
    while time.time() < fin:
        v = client.get(f"/v1/connexion/{cid}").json()
        if v.get("etape") in jusqu_a:
            return v
        time.sleep(0.2)
    raise AssertionError(f"connexion bloquée : {v}")


def connecter(client, adresse, mdp, ua="Mozilla/5.0 (Macintosh) Chrome/131.0 Safari/537.36"):
    r = client.post("/v1/connexion", json={"email": adresse, "mot_de_passe": mdp}, headers={"User-Agent": ua})
    assert r.status_code == 202, r.text
    return suivre(client, r.json()["id"])


def h(code):
    return {"Authorization": "Bearer " + code}


# ------------------------------------------------------------------ connexion
def test_connexion_simple_cree_le_compte_et_garde_la_session(client, faux):
    faux.ajouter("lea.martin@ecole.fr", "Secret-123")
    v = connecter(client, "Lea.Martin@ecole.fr", "Secret-123")
    assert v["etape"] == "reussie" and v["email"] == "lea.martin@ecole.fr" and v["role"] == "ambassadeur"
    c = client.get("/v1/compte", headers=h(v["code"])).json()
    assert c["email"] == "lea.martin@ecole.fr" and c["outlook"]["connecte"] is True
    # Le résultat n'est remis qu'une fois.
    assert client.get("/v1/connexion/" + "x" * 10).status_code == 404

    # La session Outlook est en base, chiffrée ; le mot de passe n'est écrit nulle part.
    uid = base.utilisateur_par_email("lea.martin@ecole.fr")["id"]
    o = base.outlook_lire(uid)
    etat = json.loads(coffre.ouvrir(o["etat"]))
    cookie = next(x["value"] for x in etat["cookies"] if x["name"] == "ESTSAUTH")
    assert cookie in faux.sessions  # c'est bien la session Outlook réelle
    base.fermer()
    brut = config.BASE.read_bytes() + b"".join(p.read_bytes() for p in config.BASE.parent.glob("*.db-wal"))
    assert cookie.encode() not in brut and b"Secret-123" not in brut


def test_case_rester_connecte_cochee(client, faux):
    """« Rester connecté » : le cookie Microsoft est durable, la session survit."""
    faux.ajouter("tom@ecole.fr", "x")
    connecter(client, "tom@ecole.fr", "x")
    uid = base.utilisateur_par_email("tom@ecole.fr")["id"]
    etat = json.loads(coffre.ouvrir(base.outlook_lire(uid)["etat"]))
    c = next(x for x in etat["cookies"] if x["name"] == "ESTSAUTH")
    assert c["expires"] > time.time() + 80 * 86400


def test_mauvais_mot_de_passe(client, faux):
    faux.ajouter("lea@ecole.fr", "bon")
    v = connecter(client, "lea@ecole.fr", "mauvais")
    assert v == {"id": v["id"], "etape": "echec", "message": "Adresse ou mot de passe incorrect."}
    assert base.utilisateur_par_email("lea@ecole.fr") is None  # aucun compte créé


def test_adresse_inconnue_de_microsoft(client, faux):
    v = connecter(client, "personne@ecole.fr", "x")
    assert v["etape"] == "echec" and v["message"] == "Microsoft ne reconnaît pas cette adresse."
    assert faux.essais_mdp == []  # le mot de passe n'a même pas été envoyé


def test_passer_par_la_messagerie_ne_suffit_pas(client, faux, monkeypatch):
    """Outlook web s'affiche un instant avant de renvoyer vers la connexion : sans le
    cookie que Microsoft pose après authentification, jamais de connexion réussie
    (sinon n'importe qui ouvrirait le compte d'une autre adresse)."""
    monkeypatch.setattr(config, "CONNEXION_DELAI", 6)
    monkeypatch.setattr(config, "COOKIES_AUTH", ["COOKIE_QUE_MICROSOFT_NE_POSE_PAS"])
    faux.ajouter("lea@ecole.fr", "x")
    v = connecter(client, "lea@ecole.fr", "x")
    assert v["etape"] == "echec" and base.utilisateur_par_email("lea@ecole.fr") is None


def test_adresse_d_autrui_sans_son_mot_de_passe(client, faux):
    """Taper l'adresse d'un ambassadeur existant ne donne pas accès à son compte."""
    faux.ajouter("lea@ecole.fr", "le-vrai")
    a = connecter(client, "lea@ecole.fr", "le-vrai")["code"]
    v = connecter(client, "lea@ecole.fr", "devine")
    assert v["etape"] == "echec" and "code" not in v
    assert len(client.get("/v1/sessions", headers=h(a)).json()["sessions"]) == 1


def test_compte_cle_d_acces_d_abord(client, faux):
    """Microsoft propose d'abord la clé d'accès (visage, empreinte) : le serveur passe
    par « Options de connexion » → « Utiliser mon mot de passe »."""
    faux.ajouter("lea@ieseg.fr", "Cle-1", cle=True)
    v = connecter(client, "lea@ieseg.fr", "Cle-1")
    assert v["etape"] == "reussie", v
    assert faux.essais_mdp == [("lea@ieseg.fr", "Cle-1")]


def test_portail_propre_a_l_etablissement(client, faux):
    """Microsoft renvoie vers la page de l'établissement (type Shibboleth) : identifiant
    vide rempli avec l'adresse, mot de passe, et la session Outlook est gardée."""
    faux.ajouter("lea@federe.fr", "Portail-1")
    v = connecter(client, "lea@federe.fr", "Portail-1")
    assert v["etape"] == "reussie" and v["email"] == "lea@federe.fr"
    assert faux.essais_mdp == [("lea@federe.fr", "Portail-1")]


def test_portail_propre_mauvais_mot_de_passe(client, faux):
    faux.ajouter("lea@federe.fr", "Portail-1")
    v = connecter(client, "lea@federe.fr", "faux")
    assert v["etape"] == "echec" and v["message"] == "Adresse ou mot de passe incorrect."


def test_adfs_identifiant_pre_rempli(client, faux):
    faux.ajouter("tom@adfs.fr", "Adfs-2")
    assert connecter(client, "tom@adfs.fr", "Adfs-2")["etape"] == "reussie"
    v = connecter(client, "tom@adfs.fr", "faux")
    assert v["etape"] == "echec" and v["message"] == "Adresse ou mot de passe incorrect."


def test_validation_par_nombre_sur_le_telephone(client, faux):
    faux.ajouter("lea@ecole.fr", "x", mfa="nombre")
    cid = client.post("/v1/connexion", json={"email": "lea@ecole.fr", "mot_de_passe": "x"}).json()["id"]
    v = suivre(client, cid, ("validation", "echec"))
    assert v["etape"] == "validation" and v["nombre"] == "42"
    faux.approuver("lea@ecole.fr")
    assert suivre(client, cid)["etape"] == "reussie"


def test_validation_refusee(client, faux):
    faux.ajouter("lea@ecole.fr", "x", mfa="nombre")
    cid = client.post("/v1/connexion", json={"email": "lea@ecole.fr", "mot_de_passe": "x"}).json()["id"]
    suivre(client, cid, ("validation",))
    faux.refuser("lea@ecole.fr")
    v = suivre(client, cid)
    assert v["etape"] == "echec" and "refusée" in v["message"]


def test_code_par_sms_avec_une_erreur(client, faux):
    faux.ajouter("lea@ecole.fr", "x", mfa="code", code="654321")
    cid = client.post("/v1/connexion", json={"email": "lea@ecole.fr", "mot_de_passe": "x"}).json()["id"]
    assert suivre(client, cid, ("code", "echec"))["etape"] == "code"
    assert client.post(f"/v1/connexion/{cid}/code", json={"code": "000000"}).status_code == 200
    v = suivre(client, cid, ("code",))
    fin = time.time() + 10
    while "message" not in v and time.time() < fin:
        time.sleep(0.2); v = client.get(f"/v1/connexion/{cid}").json()
    assert v["etape"] == "code" and v["message"] == "Ce code n'est pas le bon. Réessayez."
    client.post(f"/v1/connexion/{cid}/code", json={"code": "654321"})
    assert suivre(client, cid)["etape"] == "reussie"


def test_code_refuse_quand_rien_n_est_attendu(client, faux):
    faux.ajouter("lea@ecole.fr", "x", mfa="nombre")
    cid = client.post("/v1/connexion", json={"email": "lea@ecole.fr", "mot_de_passe": "x"}).json()["id"]
    suivre(client, cid, ("validation",))
    assert client.post(f"/v1/connexion/{cid}/code", json={"code": "123456"}).status_code == 409
    assert client.delete(f"/v1/connexion/{cid}").status_code == 200
    assert client.get(f"/v1/connexion/{cid}").status_code == 404


def test_trop_de_tentatives(client, faux, monkeypatch):
    monkeypatch.setattr(config, "ESSAIS_PAR_ADRESSE", 2)
    for _ in range(2):
        assert client.post("/v1/connexion", json={"email": "a@ecole.fr", "mot_de_passe": "x"}).status_code == 202
    assert client.post("/v1/connexion", json={"email": "a@ecole.fr", "mot_de_passe": "x"}).status_code == 429


def test_domaines_autorises(client, monkeypatch):
    monkeypatch.setattr(config, "DOMAINES", ["ecole.fr"])
    r = client.post("/v1/connexion", json={"email": "lea@gmail.com", "mot_de_passe": "x"})
    assert r.status_code == 403


# ------------------------------------------------------------------ la session vit sur le serveur
def test_session_outlook_rouverte_par_le_serveur_puis_revoquee(client, faux):
    faux.ajouter("lea@ecole.fr", "x")
    v = connecter(client, "lea@ecole.fr", "x")
    # Le serveur rouvre Outlook tout seul, sans mot de passe ni personne devant l'écran.
    assert client.get("/v1/outlook?verifier=1", headers=h(v["code"])).json()["connecte"] is True
    # Microsoft coupe la session (mot de passe changé, accès retiré…) : le serveur l'oublie.
    faux.revoquer("lea@ecole.fr")
    assert client.get("/v1/outlook?verifier=1", headers=h(v["code"])).json() == {"connecte": False}
    # La session Smart Mail reste, la personne n'a qu'à se reconnecter.
    assert client.get("/v1/compte", headers=h(v["code"])).status_code == 200


def test_deux_appareils_meme_compte(client, faux):
    faux.ajouter("lea@ecole.fr", "x")
    a = connecter(client, "lea@ecole.fr", "x", ua="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1")["code"]
    b = connecter(client, "lea@ecole.fr", "x", ua="Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36")["code"]
    assert client.get("/v1/compte", headers=h(a)).json()["email"] == client.get("/v1/compte", headers=h(b)).json()["email"]
    l = client.get("/v1/sessions", headers=h(a)).json()["sessions"]
    assert sorted(s["appareil"] for s in l) == ["Windows · Chrome", "iPhone · Safari"]
    assert [s["ici"] for s in l if s["appareil"].startswith("iPhone")] == [True]
    # Déconnecter les autres appareils : celui-ci reste.
    assert client.delete("/v1/sessions", headers=h(a)).json() == {"fermees": 1}
    assert client.get("/v1/compte", headers=h(b)).status_code == 401
    assert client.get("/v1/compte", headers=h(a)).status_code == 200


# ------------------------------------------------------------------ verrouillé sur son compte
def test_sessions_verrouillees_sur_leur_compte(client):
    a, ua = base.connexion_par_email("lea@ecole.fr")
    b, ub = base.connexion_par_email("tom@ecole.fr")
    base.destinataires_ajouter(ua["id"], [{"adresse": "x.y@ecole.fr"}])
    assert client.get("/v1/destinataires", headers=h(b)).json()["total"] == 0
    # Tom ne peut pas fermer la session de Léa, même en connaissant sa référence.
    ref_lea = client.get("/v1/sessions", headers=h(a)).json()["sessions"][0]["ref"]
    assert client.delete(f"/v1/sessions/{ref_lea}", headers=h(b)).status_code == 404
    assert client.get("/v1/compte", headers=h(a)).status_code == 200
    assert client.delete(f"/v1/sessions/{ref_lea}", headers=h(a)).status_code == 200
    assert client.get("/v1/compte", headers=h(a)).status_code == 401


def test_session_toujours_ouverte_par_defaut(client):
    """Installée sur l'écran d'accueil, l'app reste connectée : même après des mois sans usage."""
    a, u = base.connexion_par_email("lea@ecole.fr")
    with base._verrou:
        base.cnx().execute("UPDATE sessions SET vu = '2020-01-01T00:00:00+00:00', cree = '2020-01-01T00:00:00+00:00'")
    assert client.get("/v1/compte", headers=h(a)).status_code == 200


def test_session_reprise_par_le_cookie_de_secours(client, faux, monkeypatch):
    """L'iPhone a vidé le stockage de l'app : la session revient sans se reconnecter."""
    monkeypatch.setattr(config, "DEMO", True)
    r = client.post("/demo/session", json={"email": "lea@ecole.fr"})
    jeton = r.json()["code"]
    c = r.headers["set-cookie"].lower()
    assert "httponly" in c and "samesite=strict" in c and "path=/v1/session" in c and "max-age=34560000" in c
    # Plus de jeton local : seul le cookie reste.
    reprise = client.post("/v1/session/reprendre")
    assert reprise.status_code == 200 and reprise.json()["code"] == jeton and reprise.json()["email"] == "lea@ecole.fr"
    # Déconnexion : le cookie est effacé, la reprise ne marche plus.
    assert client.post("/v1/deconnexion", headers=h(jeton)).status_code == 200
    assert client.post("/v1/session/reprendre").json() == {"code": None}


def test_connexion_outlook_pose_le_cookie(client, faux):
    faux.ajouter("lea@ecole.fr", "x")
    r = client.post("/v1/connexion", json={"email": "lea@ecole.fr", "mot_de_passe": "x"})
    v = suivre(client, r.json()["id"])
    assert client.post("/v1/session/reprendre").json()["code"] == v["code"]


def test_reprise_sans_cookie_ou_session_fermee(client):
    assert client.post("/v1/session/reprendre").json() == {"code": None}
    a, u = base.connexion_par_email("lea@ecole.fr")
    client.cookies.set("sm_session", a, path="/v1/session")
    assert client.post("/v1/session/reprendre").status_code == 200
    base.definir_actif(u["id"], False)  # un administrateur coupe l'accès
    assert client.post("/v1/session/reprendre").json() == {"code": None}


def test_session_expiree_si_configuree(client, monkeypatch):
    monkeypatch.setattr(config, "SESSION_JOURS", 30)
    a, u = base.connexion_par_email("lea@ecole.fr")
    with base._verrou:
        base.cnx().execute("UPDATE sessions SET vu = '2020-01-01T00:00:00+00:00', cree = '2020-01-01T00:00:00+00:00'")
    assert client.get("/v1/compte", headers=h(a)).status_code == 401
    assert base.sessions_lister(u["id"]) == []  # nettoyée


def test_retirer_outlook_deconnecte_tout(client, faux):
    faux.ajouter("lea@ecole.fr", "x")
    a = connecter(client, "lea@ecole.fr", "x")["code"]
    b = connecter(client, "lea@ecole.fr", "x")["code"]
    assert client.delete("/v1/outlook", headers=h(a)).status_code == 200
    assert client.get("/v1/compte", headers=h(a)).status_code == 401 and client.get("/v1/compte", headers=h(b)).status_code == 401
    assert base.outlook_lire(base.utilisateur_par_email("lea@ecole.fr")["id"]) is None


# ------------------------------------------------------------------ rôles
def test_admin_designe_par_configuration(client, faux, monkeypatch):
    monkeypatch.setattr(config, "ADMINS", ["chef@ecole.fr"])
    faux.ajouter("chef@ecole.fr", "x")
    assert connecter(client, "chef@ecole.fr", "x")["role"] == "administrateur"


def test_administration_reservee_et_dernier_admin_protege(client):
    adm, uadm = base.connexion_par_email("chef@ecole.fr")
    base.definir_role(uadm["id"], "administrateur")
    amb, uamb = base.connexion_par_email("lea@ecole.fr")
    assert client.get("/v1/admin/membres", headers=h(amb)).status_code == 403
    assert client.put(f"/v1/admin/membres/{uamb['id']}", headers=h(amb), json={"role": "administrateur"}).status_code == 403

    r = client.get("/v1/admin/membres", headers=h(adm)).json()
    assert sorted(m["email"] for m in r["membres"]) == ["chef@ecole.fr", "lea@ecole.fr"]
    assert all(m["appareils"] == 1 for m in r["membres"])
    assert "jeton_hash" not in json.dumps(r) and "etat" not in r["membres"][0]

    # Le dernier administrateur ne peut pas se retirer.
    assert client.put(f"/v1/admin/membres/{uadm['id']}", headers=h(adm), json={"role": "ambassadeur"}).status_code == 409
    assert client.put(f"/v1/admin/membres/{uadm['id']}", headers=h(adm), json={"actif": False}).status_code == 409
    # Promotion, quota, puis coupure d'accès : ses appareils sont déconnectés.
    m = client.put(f"/v1/admin/membres/{uamb['id']}", headers=h(adm), json={"role": "administrateur", "quota_mensuel": 500}).json()
    assert m["role"] == "administrateur" and m["quota_mensuel"] == 500
    assert client.put(f"/v1/admin/membres/{uamb['id']}", headers=h(adm), json={"actif": False}).json()["actif"] is False
    assert client.get("/v1/compte", headers=h(amb)).status_code == 401
    assert client.put("/v1/admin/membres/9999", headers=h(adm), json={"actif": True}).status_code == 404
    assert client.put(f"/v1/admin/membres/{uamb['id']}", headers=h(adm), json={"role": "roi"}).status_code == 422


def test_compte_desactive_ne_se_connecte_plus(client, faux):
    faux.ajouter("lea@ecole.fr", "x")
    connecter(client, "lea@ecole.fr", "x")
    base.definir_actif(base.utilisateur_par_email("lea@ecole.fr")["id"], False)
    v = connecter(client, "lea@ecole.fr", "x")
    assert v["etape"] == "echec" and "désactivé" in v["message"]


def test_admin_cli_role(capsys):
    from app import admin
    assert admin.main(["role", "chef@ecole.fr", "administrateur"]) == 0
    assert "dès sa première connexion" in capsys.readouterr().out
    assert base.utilisateur_par_email("chef@ecole.fr")["role"] == "administrateur"
    assert admin.main(["role", "chef@ecole.fr", "ambassadeur"]) == 1  # dernier administrateur
    base.compte_outlook("lea@ecole.fr")
    assert admin.main(["role", "lea@ecole.fr", "administrateur"]) == 0
    assert admin.main(["role", "chef@ecole.fr", "ambassadeur"]) == 0
    assert admin.main(["liste"]) == 0 and "administrateur" in capsys.readouterr().out


# ------------------------------------------------------------------ coffre
def test_coffre_chiffre_et_refuse_les_falsifications():
    secret = "cookie-très-secret-é"
    a, b = coffre.fermer(secret), coffre.fermer(secret)
    assert a != b and secret not in a  # sel aléatoire
    assert coffre.ouvrir(a) == secret
    falsifie = a[:-6] + ("A" if a[-6] != "A" else "B") + a[-5:]
    assert coffre.ouvrir(falsifie) == "" and coffre.ouvrir("n'importe quoi") == "" and coffre.ouvrir("") == ""
    assert stat.S_IMODE(os.stat(config.CLE_FICHIER).st_mode) == 0o600


def test_coffre_autre_cle(monkeypatch):
    a = coffre.fermer("x")
    monkeypatch.setattr(config, "CLE_COFFRE", "une-autre-cle")
    coffre.oublier_cles()
    assert coffre.ouvrir(a) == ""  # une base volée sans sa clé ne sert à rien


def test_coffre_lit_l_ancien_format_et_va_vite():
    """Les mémoires chiffrées avant le format v2 restent lisibles, et une grosse mémoire
    (annuaire de 22 000 personnes, plusieurs Mo) se chiffre sans bloquer le serveur."""
    import base64, hashlib, hmac, secrets, time
    k_c, k_s = coffre.cles()
    sel, clair = secrets.token_bytes(16), "ancien secret é".encode()
    corps = b"v1" + sel + bytes(a ^ b for a, b in zip(clair, coffre._flot_v1(k_c, sel, len(clair))))
    ancien = base64.urlsafe_b64encode(corps + hmac.new(k_s, corps, hashlib.sha256).digest()[:16]).decode()
    assert coffre.ouvrir(ancien) == "ancien secret é"
    assert coffre.ouvrir(coffre.fermer("")) == ""
    gros = "\n".join(f"prenom{i}.nom{i}@mail.ecole.ca" for i in range(80000))
    debut = time.perf_counter()
    assert coffre.ouvrir(coffre.fermer(gros)) == gros
    assert time.perf_counter() - debut < 1.0


def test_memoire_fusionnee_sans_perdre_l_autre_travail():
    """Recherche et envoi rangent chacun leur part de la mémoire de l'extension, même
    l'un après l'autre, et l'ancien format est réécrit dans le nouveau."""
    import json
    u, _ = base.compte_outlook("fusion@ecole.fr")
    base.outlook_ecrire(u["id"], "fusion@ecole.fr", coffre.fermer("{}"))
    base.outlook_extension_fusionner(u["id"], {"mega-annuaire": "a@x.ca", "pp-campagne": "ignoree"}, lambda k: k.startswith("mega-"))
    base.outlook_extension_fusionner(u["id"], {"pp-campagne": "c1", "mega-annuaire": "ignore"}, lambda k: k.startswith("pp-"))
    brut = base.cnx().execute("SELECT extension FROM outlook WHERE utilisateur_id = ?", (u["id"],)).fetchone()[0]
    assert json.loads(coffre.ouvrir(brut)) == {"mega-annuaire": "a@x.ca", "pp-campagne": "c1"}
