"""Bout en bout du travail du serveur : il ouvre Outlook web avec la session du
compte, dans un Chromium où tourne la VRAIE extension Smart Mail (dossier
extension/), regroupe l'annuaire puis envoie. Outlook est simulé par les fausses
pages des tests de l'extension (tests/fausse-adresses, tests/fausse-outlook.html),
servies sous https://outlook.office.com. Aucune requête ne sort."""

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import base, coffre, config, service, travaux
from app.ia import FauxClasseur
from app.main import app

TESTS_EXT = Path(__file__).resolve().parents[2] / "tests"
PAGE_RELEVE = (TESTS_EXT / "fausse-adresses" / "outlook.html").read_text()
BOOK = (TESTS_EXT / "fausse-adresses" / "book.js").read_text()
PAGE_GMAIL = (TESTS_EXT / "fausse-adresses" / "gmail.html").read_text()
PAGE_GMAIL_ENVOI = (TESTS_EXT / "fausse-gmail-envoi.html").read_text().replace(
    "function publier() {}",
    "function publier() { fetch('/__envoyes', {method: 'POST', body: JSON.stringify(window.envoyes)}).catch(() => {}); }", 1)
# La fausse messagerie note chaque mail « envoyé » ; on le fait remonter au test.
PAGE_ENVOI = (TESTS_EXT / "fausse-outlook.html").read_text().replace(
    "function publier() {",
    "function publier() { fetch('/__envoyes', {method: 'POST', body: JSON.stringify(window.envoyes)}).catch(() => {});", 1)


# Fausse boîte de réception d'Outlook : la liste se met à jour toute seule (comme Outlook) ;
# un clic sur un avis l'ouvre dans « Corps du message ».
PAGE_BOITE = """<!doctype html><html><head><meta charset="utf-8"><title>Boîte de réception</title></head><body>
<div role="listbox" id="liste"></div><div role="main"><div aria-label="Corps du message" id="corps"></div></div>
<script>
async function maj() {
  let lignes = [];
  try { lignes = await (await fetch('/__boite.json')).json(); } catch (e) { return; }
  const l = document.getElementById('liste');
  if (l.dataset.n === String(lignes.length)) return;
  l.dataset.n = String(lignes.length); l.textContent = '';
  for (const x of lignes.slice().reverse()) {
    const d = document.createElement('div'); d.setAttribute('role', 'option'); d.setAttribute('data-convid', x.id);
    d.textContent = x.ligne; d.onclick = () => { document.getElementById('corps').textContent = x.corps; };
    l.appendChild(d);
  }
}
setInterval(maj, 300); maj();
</script></body></html>"""


# Les deux vrais avis d'Exchange Online (vus dans une vraie boîte, adresses changées).
def avis_blocage(n, a):
    return {"id": f"ndr-{n}", "ligne": "Microsoft Outlook Undeliverable: Certification IA Delivery has failed to these recipients or groups",
            "corps": f"Delivery has failed to these recipients or groups: {a}<mailto:{a}> This message couldn't be delivered because the "
                     "sending email address was not recognized as a valid sender. The most common reason for this error is that the email "
                     "address is, or was, suspected of sending spam. Remote server returned '550 5.1.8 Access denied, bad outbound sender AS(42004)'"}


def avis_eleve(n, a):
    return {"id": f"ndr-{n}", "ligne": "Microsoft Outlook Non remis : Certification IA ...notification d’échec de remise",
            "corps": f"Votre message envoyé à {a} n’a pas pu être remis. Code d’état : 550 5.1.10"}


@pytest.fixture
def envoyes():
    return {"liste": [], "total": [], "boite": []}


@pytest.fixture
def client(monkeypatch, envoyes):
    monkeypatch.setattr(config, "FAUX_CLAUDE", True)
    monkeypatch.setattr(config, "DEMO", False)
    monkeypatch.setattr(config, "OUTLOOK_ARRIVEE", ["https://outlook.office.com/"])
    monkeypatch.setattr(config, "PAS_SUIVI", 0.5)
    monkeypatch.setattr(config, "PAS_SAUVEGARDE", 2)
    monkeypatch.setattr(config, "PAS_BOITE", 0.5)
    monkeypatch.setattr(travaux, "ECART_REPRISE", 0)
    monkeypatch.setattr(config, "VERIFIER_LIENS", False)
    monkeypatch.setattr(travaux, "DELAI_RELANCE", 1)
    service.definir_classeur(FauxClasseur())

    async def routes(contexte):
        async def servir(route):
            chemin = route.request.url.split("outlook.office.com", 1)[1].split("?")[0]
            if chemin == "/__boite.json":
                return await route.fulfill(status=200, content_type="application/json", body=json.dumps(envoyes["boite"]))
            if chemin.startswith("/mail/inbox"):
                return await route.fulfill(status=200, content_type="text/html; charset=utf-8", body=PAGE_BOITE)
            if chemin == "/__envoyes":
                liste = json.loads(route.request.post_data or "[]")
                envoyes["liste"] = liste
                return await route.fulfill(status=204)
            if chemin.endswith("/book.js"):
                return await route.fulfill(status=200, content_type="text/javascript; charset=utf-8", body=BOOK)
            if chemin.startswith("/releve/"):
                return await route.fulfill(status=200, content_type="text/html; charset=utf-8", body=PAGE_RELEVE)
            return await route.fulfill(status=200, content_type="text/html; charset=utf-8", body=PAGE_ENVOI)
        await contexte.route("https://outlook.office.com/**", servir)

        async def gmail(route):
            chemin = route.request.url.split("mail.google.com", 1)[1].split("?")[0]
            if chemin == "/__envoyes":
                envoyes["liste"] = json.loads(route.request.post_data or "[]")
                return await route.fulfill(status=204)
            if chemin.endswith("/book.js"):
                return await route.fulfill(status=200, content_type="text/javascript; charset=utf-8", body=BOOK)
            page = PAGE_GMAIL_ENVOI if "/envoi" in chemin else PAGE_GMAIL
            return await route.fulfill(status=200, content_type="text/html; charset=utf-8", body=page)
        await contexte.route("https://mail.google.com/**", gmail)
    monkeypatch.setattr(travaux, "installer_routes", routes)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def compte():
    """Un ambassadeur connecté, avec sa session Outlook gardée par le serveur."""
    u, _ = base.compte_outlook("lea@essca.fr")
    etat = {"cookies": [{"name": "ESTSAUTH", "value": "session-de-test", "domain": "outlook.office.com", "path": "/",
                         "expires": -1, "httpOnly": True, "secure": True, "sameSite": "Lax"}], "origins": []}
    base.outlook_ecrire(u["id"], "lea@essca.fr", coffre.fermer(json.dumps(etat)))
    jeton = base.ouvrir_session(u["id"], "test")
    return {"id": u["id"], "h": {"Authorization": "Bearer " + jeton}}


def attendre(client, h, type_, statuts=("fini", "erreur", "pause"), delai=150):
    fin = time.time() + delai
    while time.time() < fin:
        e = client.get("/v1/travail", headers=h).json()[type_]
        if e["statut"] in statuts:
            return e
        time.sleep(0.5)
    raise AssertionError(f"travail bloqué : {e}")


def test_regrouper_tout_l_annuaire(client, compte, monkeypatch):
    monkeypatch.setattr(config, "OUTLOOK_URL", "https://outlook.office.com/releve/outlook.html")
    r = client.post("/v1/annuaire/regrouper", headers=compte["h"], json={"objectif": 1000})
    assert r.status_code == 202, r.text
    assert client.post("/v1/annuaire/regrouper", headers=compte["h"], json={"objectif": 4}).status_code == 409  # une recherche à la fois
    e = attendre(client, compte["h"], "annuaire")
    assert e["type"] == "annuaire" and e["statut"] == "fini", e
    p = e["progression"]
    assert p["releves"] == 38 and e["message"].startswith("Annuaire parcouru"), e  # tout le carnet a été lu
    liste = client.get("/v1/destinataires", headers=compte["h"]).json()["personnes"]
    assert len(liste) == p["trouves"] >= 1 and p["ecartes"] == 38 - p["trouves"]
    adresses = [x["adresse"] for x in liste]
    assert all(a.endswith(("@essca.fr", "@essca.eu", "@essec.edu")) for a in adresses), adresses
    assert "baptiste.rousseau@gmail.com" not in adresses  # jamais une adresse personnelle
    assert all(x["nom"] for x in liste)  # le nom affiché par Outlook est gardé
    o = base.outlook_lire(compte["id"])
    assert "mega-annuaire" in json.loads(coffre.ouvrir(o["extension"]))  # mémoire de l'extension rangée


def test_liste_des_exclus_et_ajout_a_la_main(client, compte, monkeypatch):
    """Les exclus sont gardés avec leur raison ; l'étudiant en ajoute un : il passe dans
    « À envoyer », sort des exclus, et le tri s'en souviendra."""
    monkeypatch.setattr(config, "OUTLOOK_URL", "https://outlook.office.com/releve/outlook.html")
    client.post("/v1/annuaire/regrouper", headers=compte["h"], json={"objectif": 1000})
    e = attendre(client, compte["h"], "annuaire")
    assert e["statut"] == "fini", e
    x = client.get("/v1/exclus", headers=compte["h"]).json()
    assert x["total"] == e["progression"]["ecartes"] == 38 - e["progression"]["trouves"] and sum(x["par_genre"].values()) == x["total"]
    assert all(p["raison"] and p["genre"] for p in x["personnes"])
    assert client.get("/v1/destinataires", headers=compte["h"]).json()["exclus"] == x["total"]
    choisi = x["personnes"][0]["adresse"]
    r = client.post("/v1/exclus/ajouter", headers=compte["h"], json={"adresses": [choisi, "inconnu@ailleurs.fr"]}).json()
    assert r["ajoutes"] == 1 and r["exclus"] == x["total"] - 1  # seulement un vrai exclu de ce compte
    l = client.get("/v1/destinataires?depart=0&taille=2000", headers=compte["h"]).json()
    assert choisi in [p["adresse"] for p in l["personnes"]]
    assert base.cache_lire([choisi])[choisi][0] == "etudiant"  # le tri s'en souviendra
    # Filtre par genre.
    g = next(iter(x["par_genre"]))
    assert all(p["genre"] == g for p in client.get(f"/v1/exclus?genre={g}", headers=compte["h"]).json()["personnes"])


def test_reperes_du_compte_ignorent_les_erreurs_isolees():
    u, _ = base.compte_outlook("reperes@ecole.fr")
    base.destinataires_ajouter(u["id"], [{"adresse": f"eleve{i}@mail.ecole.ca"} for i in range(20)]
                                        + [{"adresse": f"prof{i}@ecole.ca"} for i in range(3)])  # 3 erreurs isolées
    r = base.reperes_eleves(u["id"])
    assert list(r) == ["mail.ecole.ca"] and len(r["mail.ecole.ca"]) == 5
    # Beaucoup d'erreurs passées sur le domaine du personnel, PLUS nombreuses que les élèves :
    # le sous-domaine étudiant reste le seul repère (cas réel McGill).
    base.destinataires_ajouter(u["id"], [{"adresse": f"prof{i}@ecole.ca"} for i in range(3, 40)])
    assert list(base.reperes_eleves(u["id"])) == ["mail.ecole.ca"]


def test_reperes_jamais_contamines_par_le_cache(monkeypatch):
    """Cas réel (McGill) : quelques membres du personnel (@ecole.ca) avaient été pris pour
    des élèves et étaient en cache. Ils ne doivent JAMAIS servir de repères : seuls ceux du
    compte (élèves sur @mail.ecole.ca) sont montrés à Claude."""
    from app import ia

    class Espion:
        def classer(self, contacts, reperes=None):
            self.reperes = reperes
            return ia.Lot(resultats={i: ("hors", "personnel", "test") for i in range(len(contacts))})

    u, _ = base.compte_outlook("cache@ecole.fr")
    u = base.utilisateur_par_id(u["id"])
    base.cache_ecrire([(f"prof{i}@ecole.ca", "etudiant", "etudiant", "erreur ancienne", "ia") for i in range(5)])
    espion = Espion(); service.definir_classeur(espion)
    lot = [{"adresse": f"prof{i}@ecole.ca", "nom": f"Prof {i}"} for i in range(5)] + [{"adresse": "nouveau.prof@ecole.ca", "nom": "Nouveau Prof"}]
    service.trier(u, lot, None, {"mail.ecole.ca": ["eleve1@mail.ecole.ca", "eleve2@mail.ecole.ca"]})
    assert espion.reperes == {"mail.ecole.ca": ["eleve1@mail.ecole.ca", "eleve2@mail.ecole.ca"]}  # jamais ecole.ca
    # Sans élève dans le compte, les repères du lot ne gardent qu'un domaine qui pèse vraiment.
    assert service._reperes(["a@x.fr", "b@x.fr", "c@x.fr", "d@x.fr", "p@y.fr"]) == {"x.fr": ["a@x.fr", "b@x.fr", "c@x.fr", "d@x.fr"]}
    service.definir_classeur(FauxClasseur())


def test_garde_fou_jamais_d_eleve_sur_le_domaine_du_personnel(monkeypatch):
    """Même si l'IA se trompe (ou un vieux cache), une adresse d'un autre domaine de la même
    école que celui des élèves n'est jamais gardée comme élève ; le cache est corrigé."""
    from app import ia

    class Trompe:
        def classer(self, contacts, reperes=None):
            return ia.Lot(resultats={i: ("etudiant", "etudiant", "erreur de l'IA") for i in range(len(contacts))})

    assert service.ecole("mail.mcgill.ca") == "mcgill.ca" and service.ecole("student.uni.ac.uk") == "uni.ac.uk"
    u, _ = base.compte_outlook("garde@ecole.fr")
    u = base.utilisateur_par_id(u["id"])
    service.definir_classeur(Trompe())
    lot = [{"adresse": "jean.prof@mcgill.ca", "nom": "Jean Prof"}, {"adresse": "lea.eleve@mail.mcgill.ca", "nom": "Léa Élève"},
           {"adresse": "x.y@autre-ecole.fr", "nom": "X Y"}]
    r = {x["adresse"]: x["groupe"] for x in service.trier(u, lot, None, {"mail.mcgill.ca": ["a.b@mail.mcgill.ca"]})["resultats"]}
    assert r == {"jean.prof@mcgill.ca": "hors", "lea.eleve@mail.mcgill.ca": "etudiant", "x.y@autre-ecole.fr": "etudiant"}
    assert base.cache_lire(["jean.prof@mcgill.ca"])["jean.prof@mcgill.ca"][0] == "hors"  # cache corrigé
    # Un seul domaine pour toute l'école (SNHU) : rien n'est écarté par le garde-fou.
    r = service.trier(u, [{"adresse": "anne.marie@snhu.edu", "nom": "Anne Marie"}], None, {"snhu.edu": ["c.d@snhu.edu"]})
    assert r["resultats"][0]["groupe"] == "etudiant"
    service.definir_classeur(FauxClasseur())


def test_regle_sure_retire_un_non_eleve_de_la_liste():
    """Une passerelle SMS (règle sûre), déjà dans « À envoyer » (erreur passée) : retirée vers « Exclus ».
    Jamais un avis de l'IA (jamais d'élèves retirés en masse), ni ce qui est parti, ajouté à la main, ou réservé."""
    u, _ = base.compte_outlook("coherence@ecole.fr")
    uid = u["id"]
    base.destinataires_ajouter(uid, [{"adresse": "5145551234@txt.bell.ca"}, {"adresse": "garde@mcgill.ca"},
                                     {"adresse": "main@mcgill.ca", "source": "manuel"}, {"adresse": "reserve@mcgill.ca"}])
    base.reserver(uid, ["reserve@mcgill.ca"])
    res = [{"adresse": "5145551234@txt.bell.ca", "groupe": "hors", "type": "perso", "raison": "passerelle SMS", "source": "regle"},
           {"adresse": "garde@mcgill.ca", "groupe": "hors", "type": "personnel", "raison": "domaine", "source": "ia", "garde": True},
           {"adresse": "main@mcgill.ca", "groupe": "hors", "type": "personnel", "raison": "domaine", "source": "ia", "garde": True},
           {"adresse": "reserve@mcgill.ca", "groupe": "hors", "type": "personnel", "raison": "domaine", "source": "ia", "garde": True}]
    assert base.destinataires_retirer_surs(uid, res) == 1
    restants = {x["adresse"] for x in base.destinataires_lister(uid, 0, 100)}
    assert restants == {"garde@mcgill.ca", "main@mcgill.ca", "reserve@mcgill.ca"}  # avis de l'IA, à la main, réservé : gardés
    assert base.exclus_compter(uid) == 1


def test_passerelles_sms_jamais_des_eleves():
    from app import regles
    for a in ("5145551234@txt.bell.ca", "6175551234@vtext.com", "33612345678@sms.orange.fr", "4165550000@txt.freedommobile.ca"):
        assert regles.appliquer(a)[0] == "hors", a


def test_objectif_sans_limite(client, compte):
    r = client.post("/v1/annuaire/regrouper", headers=compte["h"], json={"objectif": 250000, "nouvelle": False})
    assert r.status_code == 202, r.text
    assert client.post("/v1/annuaire/arreter", headers=compte["h"]).json()["ok"] is True
    attendre(client, compte["h"], "annuaire", delai=120)


def test_un_incertain_n_est_jamais_definitif(monkeypatch):
    """Un « incertain » n'est pas mis en cache : il sera redemandé (avec plus de repères)."""
    from app import ia

    class Classeur:
        def __init__(self, groupe):
            self.groupe, self.appels = groupe, 0

        def classer(self, contacts, reperes=None):
            self.appels += 1
            self.reperes = reperes
            return ia.Lot(resultats={i: (self.groupe, "etudiant" if self.groupe == "etudiant" else "inconnu", "test")
                                     for i in range(len(contacts))})

    u, _ = base.compte_outlook("incertain@ecole.fr")
    u = base.utilisateur_par_id(u["id"])
    contact = [{"adresse": "jeanne.dupont@exemple-ecole.fr", "nom": "Jeanne Dupont"}]
    c1 = Classeur("incertain"); service.definir_classeur(c1)
    assert service.trier(u, contact)["resultats"][0]["groupe"] == "incertain"
    c2 = Classeur("etudiant"); service.definir_classeur(c2)
    r = service.trier(u, contact, None, {"exemple-ecole.fr": ["paul.martin@exemple-ecole.fr"]})
    assert c2.appels == 1 and r["resultats"][0]["groupe"] == "etudiant"  # redemandé, pas pris dans le cache
    assert c2.reperes["exemple-ecole.fr"] == ["paul.martin@exemple-ecole.fr"]  # avec les repères du compte
    service.definir_classeur(FauxClasseur())


def test_extraire_puis_garder_seulement_les_etudiants(client, compte, monkeypatch):
    """Le parcours voulu : l'étudiant extrait d'abord tout l'annuaire (gratuit, aucune IA),
    puis « Garder seulement les étudiants » : la logique est apprise sur l'ensemble et chacun
    est trié. Ensuite, la recherche trie les nouveaux contacts au fil de l'eau."""
    from app import ia

    class Compteur(FauxClasseur):
        appels = 0

        def classer(self, contacts, reperes=None):
            Compteur.appels += 1
            return super().classer(contacts, reperes)

    service.definir_classeur(Compteur())
    monkeypatch.setattr(config, "OUTLOOK_URL", "https://outlook.office.com/releve/outlook.html")
    r = client.post("/v1/annuaire/regrouper", headers=compte["h"], json={"objectif": 100, "extraction": True})
    assert r.status_code == 202, r.text
    e = attendre(client, compte["h"], "annuaire")
    assert e["statut"] == "fini" and e["message"].startswith("Annuaire extrait : 38 contacts"), e
    l = client.get("/v1/destinataires", headers=compte["h"]).json()
    assert l["total"] == 0 and l["extraits"] == 38 and l["a_trier"] == 38 and l["exclus"] == 0
    assert Compteur.appels == 0  # extraction : aucun appel à l'IA
    x = client.get("/v1/extraits?depart=0&taille=10", headers=compte["h"]).json()
    assert x["total"] == 38 and len(x["personnes"]) == 10 and all(p["nom"] for p in x["personnes"])
    # « Garder seulement les étudiants ».
    assert client.post("/v1/tri/lancer", headers=compte["h"]).status_code == 202
    t = attendre(client, compte["h"], "tri")
    assert t["statut"] == "fini" and t["message"].startswith("Terminé"), t
    l = client.get("/v1/destinataires", headers=compte["h"]).json()
    assert l["a_trier"] == 0 and l["total"] >= 1 and l["total"] + l["exclus"] == 38, l
    assert l["logique"]  # la logique de l'école, lisible
    assert base.logique_lire(compte["id"]) is not None
    assert all(a["adresse"].endswith(("@essca.fr", "@essca.eu", "@essec.edu"))
               for a in client.get("/v1/destinataires?depart=0&taille=100", headers=compte["h"]).json()["personnes"])
    # La recherche suivante trie au fil de l'eau (logique connue) : rien ne reste à trier.
    client.post("/v1/annuaire/regrouper", headers=compte["h"], json={"objectif": 1000, "nouvelle": False, "extraction": True})
    e = attendre(client, compte["h"], "annuaire")
    assert e["statut"] == "fini" and not e["message"].startswith("Annuaire extrait"), e
    assert client.get("/v1/destinataires", headers=compte["h"]).json()["a_trier"] == 0
    assert client.post("/v1/tri/lancer", headers=compte["h"]).status_code == 202  # possible à tout moment
    attendre(client, compte["h"], "tri")
    service.definir_classeur(FauxClasseur())


def test_tri_sans_extraction_refuse(client, compte):
    r = client.post("/v1/tri/lancer", headers=compte["h"])
    assert r.status_code == 409 and "extraction" in r.json()["detail"]


def test_tableau_admin_alertes_et_pause(client, compte, monkeypatch):
    """Le tableau administrateur : vue d'ensemble, une fiche par ambassadeur, les alertes
    (boîte bloquée 5.1.8, IA indisponible, session absente, Claude en panne), et la pause
    d'un travail par l'administrateur. Réservé aux administrateurs."""
    from app import ia
    jeton_adm, adm = base.connexion_par_email("chef@essca.fr")
    base.definir_role(adm["id"], "administrateur")
    ha = {"Authorization": "Bearer " + jeton_adm}
    assert client.get("/v1/admin/tableau", headers=compte["h"]).status_code == 403  # un ambassadeur n'y a pas accès
    # Un envoi bloqué par Microsoft, une recherche arrêtée faute d'IA.
    base.travail_ecrire(compte["id"], "envoi", "pause", {}, {"blocage": True, "envoyes": 2, "total": 6}, "Envoi mis en pause : 5.1.8")
    base.travail_ecrire(compte["id"], "annuaire", "erreur", {}, {}, travaux.MESSAGE_IA_INDISPONIBLE)
    # Un autre ambassadeur sans session Outlook, avec des élèves à envoyer.
    _, sans = base.connexion_par_email("tom@essca.fr")
    base.destinataires_ajouter(sans["id"], [{"adresse": "eleve1@essca.fr"}])
    monkeypatch.setitem(ia.SANTE, "panne", time.time())
    monkeypatch.setitem(ia.SANTE, "raison", "crédit Anthropic épuisé")
    monkeypatch.setitem(ia.SANTE, "ok", 0.0)
    t = client.get("/v1/admin/tableau", headers=ha).json()
    assert {"membres", "sessions", "recherches", "envois", "a_envoyer", "depense", "navigateurs", "maximum"} <= set(t["total"])
    textes = [x["texte"] for x in t["alertes"]]
    assert t["alertes"][0]["niveau"] == "critique" and "Claude ne répond plus" in textes[0] and "console.anthropic.com" in textes[0]
    assert any("bloqué la boîte de lea@essca.fr" in x for x in textes)
    assert any("La recherche de lea@essca.fr" in x and "indisponible" in x for x in textes)
    assert any("tom@essca.fr n'a plus de session de messagerie" in x for x in textes)
    fiche = next(f for f in t["membres"] if f["email"] == "lea@essca.fr")
    assert fiche["session"]["connecte"] and fiche["travaux"]["envoi"]["statut"] == "pause" and "a_envoyer" in fiche["liste"]
    b = client.get("/v1/admin/alertes", headers=ha).json()
    assert b["nombre"] == len(t["alertes"]) and b["critiques"] >= 3
    # La pause par l'administrateur, sur une vraie recherche.
    monkeypatch.setattr(config, "OUTLOOK_URL", "https://outlook.office.com/releve/outlook.html")
    client.post("/v1/annuaire/regrouper", headers=compte["h"], json={"objectif": 1000, "nouvelle": False})
    fin = time.time() + 120
    while time.time() < fin and not client.get("/v1/travail", headers=compte["h"]).json()["annuaire"]["progression"].get("releves"):
        time.sleep(0.3)
    assert client.post(f"/v1/admin/membres/{compte['id']}/pause", headers=compte["h"], json={"travail": "annuaire"}).status_code == 403
    assert client.post(f"/v1/admin/membres/{compte['id']}/pause", headers=ha, json={"travail": "annuaire"}).json() == {"ok": True}
    e = attendre(client, compte["h"], "annuaire")
    assert e["message"].startswith("Recherche en pause"), e



def test_console_admin_detail_journal_et_reprise(client, compte, monkeypatch):
    """La console d'administration : la page /admin, le détail d'une session (rien de chiffré,
    ni cookie ni jeton), le journal (lancement, pause et reprise par l'administrateur), et la
    déconnexion d'un appareil. Réservé aux administrateurs."""
    jeton_adm, adm = base.connexion_par_email("chef@essca.fr")
    base.definir_role(adm["id"], "administrateur")
    ha = {"Authorization": "Bearer " + jeton_adm}
    page = client.get("/admin")
    assert page.status_code == 200 and "Console Smart Mail" in page.text and "admin.js" in page.text
    uid = compte["id"]
    for url in (f"/v1/admin/membres/{uid}/detail", "/v1/admin/journal"):
        assert client.get(url, headers=compte["h"]).status_code == 403
    assert client.post(f"/v1/admin/membres/{uid}/reprendre", headers=compte["h"], json={"travail": "envoi"}).status_code == 403
    d = client.get(f"/v1/admin/membres/{uid}/detail", headers=ha).json()
    assert d["email"] == "lea@essca.fr" and d["messagerie"] == {**d["messagerie"], "connecte": True, "type": "outlook"}
    assert len(d["envois_jour"]) == 14 and d["appareils_liste"] and {"journal", "derniers", "rythme", "travaux"} <= set(d)
    brut = json.dumps(d)
    assert "session-de-test" not in brut and "jeton_hash" not in brut and "extension" not in d["messagerie"]
    assert client.get("/v1/admin/membres/9999/detail", headers=ha).status_code == 404
    assert client.post(f"/v1/admin/membres/{uid}/reprendre", headers=ha, json={"travail": "envoi"}).status_code == 409  # rien à reprendre
    # Une recherche lancée par l'ambassadeur, mise en pause puis reprise par l'administrateur.
    monkeypatch.setattr(config, "OUTLOOK_URL", "https://outlook.office.com/releve/outlook.html")
    assert client.post("/v1/annuaire/regrouper", headers=compte["h"], json={"objectif": 1000, "nouvelle": False}).status_code == 202
    fin = time.time() + 120
    while time.time() < fin and not client.get("/v1/travail", headers=compte["h"]).json()["annuaire"]["progression"].get("releves"):
        time.sleep(0.3)
    t = client.get("/v1/admin/tableau", headers=ha).json()
    f = next(x for x in t["membres"] if x["id"] == uid)
    assert f["travaux"]["annuaire"]["actif"] and f["travaux"]["annuaire"]["progres"] and t["serveur"]["coeurs"] >= 1 and t["ia"]["ok"]
    assert client.post(f"/v1/admin/membres/{uid}/pause", headers=ha, json={"travail": "annuaire"}).json() == {"ok": True}
    e = attendre(client, compte["h"], "annuaire")
    assert e["message"].startswith("Recherche en pause"), e
    r = client.post(f"/v1/admin/membres/{uid}/reprendre", headers=ha, json={"travail": "annuaire"})
    assert r.status_code == 202, r.text
    attendre(client, compte["h"], "annuaire", delai=240)
    textes = [x["texte"] for x in client.get(f"/v1/admin/journal?membre={uid}", headers=ha).json()["evenements"]]
    assert any(x.startswith("Recherche relancée (objectif 1") for x in textes), textes
    assert "Recherche : pause demandée par l'administrateur chef@essca.fr." in textes, textes
    assert any(x.startswith("Recherche en pause") for x in textes), textes
    assert "Recherche : reprise demandée par l'administrateur chef@essca.fr." in textes, textes
    assert not any(x.startswith("Recherche : Recherche") for x in textes), textes
    # Le fil se lit page par page.
    p1 = client.get("/v1/admin/journal?taille=2", headers=ha).json()
    assert len(p1["evenements"]) == 2 and p1["suite"]
    p2 = client.get(f"/v1/admin/journal?taille=2&avant={p1['suite']}", headers=ha).json()
    assert p2["evenements"] and p2["evenements"][0]["id"] < p1["evenements"][-1]["id"]
    # Un appareil de l'ambassadeur déconnecté par l'administrateur : ce jeton ne marche plus.
    ref = next(a["ref"] for a in client.get(f"/v1/admin/membres/{uid}/detail", headers=ha).json()["appareils_liste"])
    assert client.delete(f"/v1/admin/membres/{uid}/appareils/{ref}", headers=ha).json() == {"ok": True}
    assert client.get("/v1/compte", headers=compte["h"]).status_code == 401
    assert client.delete(f"/v1/admin/membres/{uid}/appareils/{ref}", headers=ha).status_code == 404


def test_journal_paliers_attentes_et_travail_immobile(client, compte, monkeypatch):
    """Le journal note les paliers une seule fois (1 000 élèves trouvés…), un pack terminé une
    seule fois, les élèves non distribués ; et un travail en cours qui n'avance plus depuis
    15 min déclenche une alerte, sauf une attente normale (pause entre deux packs)."""
    uid = compte["id"]
    jeton_adm, adm = base.connexion_par_email("chef@essca.fr")
    base.definir_role(adm["id"], "administrateur")
    ha = {"Authorization": "Bearer " + jeton_adm}
    for ty in ("annuaire", "envoi"):
        travaux._suivi.pop((uid, ty), None)
    for n in (998, 999, 1000, 1001, 1500, 2100):
        travaux._maj(uid, "annuaire", "en_cours", {}, {"trouves": n, "releves": 2 * n, "extraits": 2 * n}, "Lecture de l'annuaire…")
    pack = {"taille": 5, "attente": 30, "dans_pack": 5, "prochain": time.time() + 600}
    travaux._maj(uid, "envoi", "en_cours", {}, {"curseur": 4, "envoyes": 4, "total": 40}, "Pack en cours : 4 / 5 mails.")
    for _ in range(3):  # même message à chaque relevé : une seule ligne ; 2 non distribués : une seule ligne
        travaux._maj(uid, "envoi", "en_cours", {}, {"curseur": 5, "envoyes": 5, "total": 40, "pack": pack, "non_distribues": 2},
                     "Pack terminé. Prochain pack de 5 mails à 14 h 30.")
    lignes = [x["texte"] for x in base.journal_lire(uid, taille=50)]
    assert sum("1\u202f000 élèves trouvés" in x for x in lignes) == 1 and sum("2\u202f000 élèves trouvés" in x for x in lignes) == 1, lignes
    assert sum(x.startswith("Envoi : Pack terminé") for x in lignes) == 1, lignes
    assert sum("2 élève(s) n'ont pas reçu le message" in x for x in lignes) == 1, lignes
    # Les deux « tournent » (navigateurs ouverts) ; plus aucun progrès depuis 20 min.
    monkeypatch.setattr(travaux, "en_cours", lambda u, ty: object() if u == uid and ty in ("annuaire", "envoi") else None)
    for ty in ("annuaire", "envoi"):
        travaux._suivi[(uid, ty)]["progres"] = time.time() - 20 * 60
    t = client.get("/v1/admin/tableau", headers=ha).json()
    textes = [a["texte"] for a in t["alertes"]]
    assert any("La recherche de lea@essca.fr n'avance plus depuis 20 min" in x for x in textes), textes
    assert not any("L'envoi de lea@essca.fr n'avance plus" in x for x in textes), textes  # pause entre deux packs : normal
    f = next(x for x in t["membres"] if x["id"] == uid)
    assert f["travaux"]["annuaire"]["immobile"] >= 1200 and not f["travaux"]["envoi"]["immobile"]
    probl = client.get(f"/v1/admin/journal?membre={uid}&problemes=true", headers=ha).json()["evenements"]
    assert probl and all(x["niveau"] in ("attention", "critique") for x in probl)


def test_ecrans_de_la_console(client, compte):
    """Un administrateur ouvre l'écran d'un ambassadeur : une session « Console administrateur »
    sur SON compte (visible dans ses appareils), qui voit et fait ce qu'il voit et fait, sauf ce
    qui ne regarde que lui ; le journal dit qui a agi ; le cookie de l'administrateur n'est jamais
    touché ; l'écran se ferme."""
    jeton_adm, adm = base.connexion_par_email("chef@essca.fr")
    base.definir_role(adm["id"], "administrateur")
    ha, uid = {"Authorization": "Bearer " + jeton_adm}, compte["id"]
    assert client.post(f"/v1/admin/membres/{uid}/ecran", headers=compte["h"]).status_code == 403  # réservé aux administrateurs
    assert client.post("/v1/admin/membres/9999/ecran", headers=ha).status_code == 404
    r = client.post(f"/v1/admin/membres/{uid}/ecran", headers=ha).json()
    he = {"Authorization": "Bearer " + r["jeton"]}
    avant = base.derniere_activite(uid)
    assert client.get("/v1/compte", headers=he).json()["email"] == "lea@essca.fr"  # son compte, ses chiffres
    assert base.derniere_activite(uid) == avant  # la console ne compte pas comme une visite de l'ambassadeur
    appareils = [x["appareil"] for x in client.get("/v1/sessions", headers=compte["h"]).json()["sessions"]]
    assert "Console administrateur · chef@essca.fr" in appareils
    # Ce qui ne regarde que l'ambassadeur : refusé depuis la console.
    assert client.delete("/v1/outlook", headers=he).status_code == 403
    assert client.delete("/v1/sessions", headers=he).status_code == 403
    assert base.outlook_lire(uid) and client.get("/v1/compte", headers=compte["h"]).status_code == 200
    # Le journal note qui a agi : la console…
    assert client.put("/v1/annuaire/objectif", headers=he, json={"objectif": 1234}).status_code == 200
    # …ou l'ambassadeur lui-même.
    assert client.put("/v1/annuaire/objectif", headers=compte["h"], json={"objectif": 1500}).status_code == 200
    textes = [x["texte"] for x in base.journal_lire(uid, taille=10)]
    assert "Objectif de la recherche fixé à 1\u202f234 élèves. (depuis la console, par chef@essca.fr)" in textes, textes
    assert "Objectif de la recherche fixé à 1\u202f500 élèves." in textes, textes
    assert any(x == "Écran ouvert dans la console par chef@essca.fr." for x in textes), textes
    # Un travail lancé depuis la console : seule la demande porte la mention, pas ce qu'il fait ensuite.
    base.extraits_ajouter(uid, [{"adresse": f"prenom{i}.nom{i}@essca.fr", "nom": f"Prénom{i} Nom{i}"} for i in range(6)])
    assert client.post("/v1/tri/lancer", headers=he).status_code == 202
    attendre(client, compte["h"], "tri")
    textes = [x["texte"] for x in base.journal_lire(uid, taille=10)]
    assert any(x.startswith("« Garder seulement les étudiants » lancé") and x.endswith("(depuis la console, par chef@essca.fr)") for x in textes), textes
    assert any(x.startswith("Tri : Terminé : ") and "console" not in x for x in textes), textes
    # Se déconnecter depuis l'écran ne touche pas au cookie de l'administrateur.
    r2 = client.post(f"/v1/admin/membres/{uid}/ecran", headers=ha).json()
    sortie = client.post("/v1/deconnexion", headers={"Authorization": "Bearer " + r2["jeton"]})
    assert sortie.status_code == 200 and "set-cookie" not in sortie.headers
    # Fermer l'écran : sa session disparaît, celle de l'ambassadeur reste.
    assert client.delete(f"/v1/admin/membres/{uid}/ecran", headers=ha).json()["fermees"] == 1
    assert client.get("/v1/compte", headers=he).status_code == 401
    assert client.get("/v1/compte", headers=compte["h"]).status_code == 200


def test_outlook_gele_la_recherche_attend_puis_repart(client, compte, monkeypatch):
    """Outlook ne répond plus pendant un moment (page surchargée) : la recherche attend au lieu
    de s'arrêter ; s'il reste gelé trop longtemps, elle repart toute seule une minute après."""
    from playwright.async_api import TimeoutError as PT
    monkeypatch.setattr(config, "OUTLOOK_URL", "https://outlook.office.com/releve/outlook.html")
    vrai, gele = travaux._actif, {"n": 2}
    async def actif(page, nom):
        if gele["n"] > 0:
            gele["n"] -= 1
            raise PT("Locator.is_visible: Timeout 30000ms exceeded.")
        return await vrai(page, nom)
    monkeypatch.setattr(travaux, "_actif", actif)
    monkeypatch.setattr(travaux.asyncio, "sleep", _sommeil_court(travaux.asyncio.sleep))
    h = compte["h"]
    assert client.post("/v1/annuaire/regrouper", headers=h, json={"objectif": 1000, "nouvelle": True}).status_code == 202
    e = attendre(client, h, "annuaire", delai=240)
    assert e["statut"] == "fini" and gele["n"] == 0, e  # deux gels absorbés, la recherche a fini normalement
    # Gelé trop longtemps (au-delà de la patience du démarrage) : elle s'arrête proprement, puis
    # repart toute seule dès qu'Outlook répond de nouveau.
    monkeypatch.setattr(travaux, "GELS_MAX", 1)
    gele["n"] = 10_000
    assert client.post("/v1/annuaire/regrouper", headers=h, json={"objectif": 1000, "nouvelle": False}).status_code == 202
    e = attendre(client, h, "annuaire", statuts=("attente",), delai=120)
    fin = time.time() + 60
    while e["message"] != travaux.OUTLOOK_GELE and time.time() < fin:
        time.sleep(0.3)
        e = client.get("/v1/travail", headers=h).json()["annuaire"]
    assert e["message"] == travaux.OUTLOOK_GELE, e
    gele["n"] = 0  # Outlook répond de nouveau
    e = attendre(client, h, "annuaire", delai=240)
    assert e["statut"] == "fini", e


def _sommeil_court(vrai):
    async def sommeil(d, *a, **k):
        return await vrai(min(d, 0.5), *a, **k)
    return sommeil


def test_reprise_ne_retrie_jamais_ce_qui_est_deja_trie(client, compte, monkeypatch):
    """Une recherche qui reprend (après un redémarrage, ou relancée) ne retrie jamais un contact
    déjà dans la liste ou dans « Exclus » : une décision prise n'est plus remise en cause."""
    monkeypatch.setattr(config, "OUTLOOK_URL", "https://outlook.office.com/releve/outlook.html")
    vrai, vus = service.trier, []
    def trier(u, contacts, *a, **k):
        vus.extend(c["adresse"].lower() for c in contacts)
        return vrai(u, contacts, *a, **k)
    monkeypatch.setattr(service, "trier", trier)
    h, uid = compte["h"], compte["id"]
    assert client.post("/v1/annuaire/regrouper", headers=h, json={"objectif": 100000, "nouvelle": True}).status_code == 202
    attendre(client, h, "annuaire", delai=240)
    deja = base.adresses_triees(uid)
    assert deja and len(deja) == base.destinataires_compter(uid) + base.exclus_compter(uid)
    vus.clear()
    assert client.post("/v1/annuaire/regrouper", headers=h, json={"objectif": 100000, "nouvelle": False}).status_code == 202
    attendre(client, h, "annuaire", delai=240)
    assert not (set(vus) & deja), len(set(vus) & deja)


def test_seule_une_regle_sure_retire_de_la_liste(compte):
    """Ni l'IA ni le garde-fou de domaine ne retirent quelqu'un de « À envoyer » : seule une règle
    sûre (passerelle SMS, boîte de service) le peut."""
    uid = compte["id"]
    base.destinataires_ajouter(uid, [{"adresse": "anna.lee@essca.fr", "nom": "Anna Lee"}, {"adresse": "5145550000@txt.bell.ca", "nom": ""}])
    devine = {"adresse": "anna.lee@essca.fr", "groupe": "hors", "type": "personnel", "raison": "x", "source": "ia", "garde": True}
    sure = {"adresse": "5145550000@txt.bell.ca", "groupe": "hors", "type": "service", "raison": "passerelle SMS", "source": "regle"}
    assert base.destinataires_retirer_surs(uid, [devine, sure]) == 1
    restants = {d["adresse"] for d in base.destinataires_lister(uid)}
    assert "anna.lee@essca.fr" in restants and "5145550000@txt.bell.ca" not in restants


def test_analyse_une_seule_fois_verifiee_quand_trop_peu_d_etudiants(client, compte, monkeypatch):
    """« Garder seulement les étudiants » : une seule pression. Une logique qui garde trop peu
    d'étudiants (ils sont normalement majoritaires) est revue une fois par Claude ; ensuite elle est
    réutilisée sans nouvel appel tant que l'annuaire n'a pas doublé."""
    from app import logique as lm
    uid, h = compte["id"], compte["h"]
    base.extraits_ajouter(uid, [{"adresse": f"prenom{i}.nom{i}@essca.fr", "nom": f"Prenom{i} Nom{i}"} for i in range(40)]
                          + [{"adresse": f"p{i}.prof{i}@essca.fr", "nom": f"P{i} Prof{i}"} for i in range(4)])
    appels = []
    class Apprenti:
        def apprendre_global(self, contacts, remarque=""):
            appels.append(remarque)
            if not remarque:  # première idée : tout le monde serait du personnel
                return lm.Logique(domaines=[lm.RegleDomaine(domaine="essca.fr", formats_personnel=["prenom.nom"])], resume="faux"), 0.0, ""
            return lm.Logique(domaines=[lm.RegleDomaine(domaine="essca.fr", formats_etudiant=["prenom.nom"])], resume="Étudiants en prenom.nom@essca.fr."), 0.0, ""
    monkeypatch.setattr(lm, "apprenti", lambda: Apprenti())
    assert client.post("/v1/tri/lancer", headers=h).status_code == 202
    e = attendre(client, h, "tri")
    assert e["statut"] == "fini", e
    assert len(appels) == 2 and "Vérification" in appels[1], appels
    assert base.destinataires_compter(uid, "a_envoyer") >= 40  # les étudiants (majoritaires) sont gardés
    assert base.logique_lire(uid)["appris_sur"] == 44
    assert any(x["texte"].startswith("Logique vérifiée une seconde fois") for x in base.journal_lire(uid, taille=10))
    # Deuxième pression avec le même annuaire : la logique est réutilisée, aucun appel à Claude.
    base.extraits_ajouter(uid, [{"adresse": "nouvelle.eleve@essca.fr", "nom": "Nouvelle Eleve"}])
    assert client.post("/v1/tri/lancer", headers=h).status_code == 202
    attendre(client, h, "tri")
    assert len(appels) == 2 and base.extraits_compter(uid, non_tries=True) == 0

def test_collecte_gmail_extraire_puis_trier(client):
    """Un ambassadeur connecté avec Gmail : la recherche ouvre Gmail, relève l'annuaire de
    l'école dans « À », puis « Garder seulement les étudiants » trie, comme avec Outlook.
    L'envoi depuis Gmail n'est pas encore là : il est refusé clairement."""
    u, _ = base.compte_outlook("ana@essca.fr")
    etat = {"cookies": [{"name": "SID", "value": "session-de-test", "domain": "mail.google.com", "path": "/",
                         "expires": -1, "httpOnly": True, "secure": True, "sameSite": "Lax"}], "origins": []}
    base.outlook_ecrire(u["id"], "ana@essca.fr", coffre.fermer(json.dumps(etat)), "gmail")
    h = {"Authorization": "Bearer " + base.ouvrir_session(u["id"], "test")}
    r = client.post("/v1/annuaire/regrouper", headers=h, json={"objectif": 1000, "extraction": True})
    assert r.status_code == 202, r.text
    e = attendre(client, h, "annuaire", delai=240)
    assert e["statut"] == "fini" and e["message"].startswith("Annuaire extrait"), e
    l = client.get("/v1/destinataires", headers=h).json()
    assert l["extraits"] >= 30 and l["total"] == 0, l
    noms = client.get("/v1/extraits?depart=0&taille=50", headers=h).json()["personnes"]
    assert sum(1 for p in noms if p["nom"]) >= 20  # le nom affiché par Gmail est gardé
    assert client.post("/v1/tri/lancer", headers=h).status_code == 202
    t = attendre(client, h, "tri", delai=120)
    assert t["statut"] == "fini", t
    l = client.get("/v1/destinataires", headers=h).json()
    assert l["total"] >= 1 and l["total"] + l["exclus"] == l["extraits"], l
    # (l'envoi depuis Gmail est possible : voir test_envoi_depuis_gmail)


def test_envoi_depuis_gmail(client, envoyes, monkeypatch):
    """Envoi depuis Gmail : même moteur (packs, jamais deux fois, suivi), gestes de Gmail.
    Un test à soi-même, puis le vrai envoi : chaque élève reçoit son mail une seule fois,
    avec l'objet, le texte et le lien cliquable."""
    monkeypatch.setattr(config, "GMAIL_URL", "https://mail.google.com/mail/u/0/envoi")
    u, _ = base.compte_outlook("ines@essca.fr")
    etat = {"cookies": [{"name": "SID", "value": "session-de-test", "domain": "mail.google.com", "path": "/",
                         "expires": -1, "httpOnly": True, "secure": True, "sameSite": "Lax"}], "origins": []}
    base.outlook_ecrire(u["id"], "ines@essca.fr", coffre.fermer(json.dumps(etat)), "gmail")
    h = {"Authorization": "Bearer " + base.ouvrir_session(u["id"], "test")}
    texte = "Bonjour,\n\n[GET YOUR REETMA AI CERTIFICATION](https://reetma-agency.com/school)\n\nÀ bientôt"
    assert client.post("/v1/envoi/test", headers=h, json={"objet": "Certification IA", "texte": texte}).status_code == 202
    fin = time.time() + 150
    while time.time() < fin and client.get("/v1/envoi/test", headers=h).json()["statut"] not in ("fini", "erreur"):
        time.sleep(0.5)
    t = client.get("/v1/envoi/test", headers=h).json()
    assert t["statut"] == "fini" and "ines@essca.fr" in t["message"], t
    # (préréglage Google : 495 destinataires par mail, en Cci — le test à soi-même part donc en Cci)
    assert [m["a"] + m.get("cci", []) for m in envoyes["liste"]] == [["ines@essca.fr"]] and envoyes["liste"][0]["objet"].startswith("[Test] ")
    # Le vrai envoi.
    envoyes["liste"] = []
    base.destinataires_ajouter(u["id"], [{"adresse": f"eleve{i}@essca.fr", "nom": f"Élève {i}"} for i in (1, 2, 3)])
    client.put("/v1/parametres", headers=h, json={"pack": 20, "attente": 1, "heure_debut": 0, "heure_fin": 24, "destinataires": 1})
    assert client.post("/v1/envoi", headers=h, json={"objet": "Certification IA", "texte": texte}).status_code == 202
    e = attendre(client, h, "envoi", delai=240)
    assert e["statut"] == "fini" and e["progression"]["envoyes"] == 3, e
    assert [m["a"] for m in envoyes["liste"]] == [[f"eleve{i}@essca.fr"] for i in (1, 2, 3)]  # chacun une fois
    m = envoyes["liste"][0]
    assert m["objet"] == "Certification IA" and "Bonjour" in m["corps"]
    assert 'href="https://reetma-agency.com/school"' in m["html"] and "GET YOUR REETMA AI CERTIFICATION" in m["html"]
    statuts = {x["adresse"]: x["statut"] for x in client.get("/v1/destinataires", headers=h).json()["personnes"]}
    assert set(statuts.values()) == {"envoye"}


def test_regrouper_s_arrete_a_l_objectif(client, compte, monkeypatch):
    monkeypatch.setattr(config, "OUTLOOK_URL", "https://outlook.office.com/releve/outlook.html")
    client.post("/v1/annuaire/regrouper", headers=compte["h"], json={"objectif": 1})
    e = attendre(client, compte["h"], "annuaire")
    assert e["statut"] == "fini" and e["message"].startswith("Objectif atteint"), e
    assert e["progression"]["trouves"] == 1 and e["progression"]["releves"] < 38  # pile l'objectif, arrêté avant la fin
    assert client.get("/v1/destinataires", headers=compte["h"]).json()["total"] == 1


def test_ia_en_panne_personne_n_est_exclu(client, compte, monkeypatch):
    """Cas réel (McGill) : crédit Claude épuisé. Avant, tous les contacts non triés
    finissaient « exclus ». Maintenant : pause claire, aucun exclu par erreur ; une fois
    le crédit rechargé, la recherche relancée trouve bien les élèves."""
    from app import ia, logique as logique_mod

    class EnPanne:
        def classer(self, contacts, reperes=None):
            return ia.Lot(erreur="crédit Anthropic épuisé")

    class ApprentiEnPanne:
        def apprendre(self, echantillon):
            return None, 0.0, "crédit Anthropic épuisé"

    monkeypatch.setattr(config, "OUTLOOK_URL", "https://outlook.office.com/releve/outlook.html")
    service.definir_classeur(EnPanne())
    vrai_apprenti = logique_mod.apprenti
    monkeypatch.setattr(logique_mod, "apprenti", lambda: ApprentiEnPanne())
    client.post("/v1/annuaire/regrouper", headers=compte["h"], json={"objectif": 1000})
    e = attendre(client, compte["h"], "annuaire")
    assert e["statut"] == "erreur" and "indisponible" in e["message"] and "Rien n'est perdu" in e["message"], e
    exclus_regles = e["progression"]["ecartes"]
    assert e["progression"]["trouves"] == 0
    assert exclus_regles <= 3, e  # seuls les exclus sûrs (règles : messagerie perso…), jamais les non triés
    # Crédit rechargé : on relance, les élèves sont trouvés (rien n'avait été jeté).
    service.definir_classeur(FauxClasseur())
    monkeypatch.setattr(logique_mod, "apprenti", vrai_apprenti)
    client.post("/v1/annuaire/regrouper", headers=compte["h"], json={"objectif": 1000, "nouvelle": False})
    e = attendre(client, compte["h"], "annuaire")
    assert e["statut"] == "fini" and e["progression"]["trouves"] >= 1, e
    assert e["progression"]["releves"] == 38


def test_reprise_apres_redemarrage_pendant_un_releve(client, compte, monkeypatch):
    """Cas réel (Neoma) : le serveur redémarre en plein relevé ; la mémoire gardée note
    « relevé en cours » il y a une seconde. La recherche doit repartir quand même."""
    monkeypatch.setattr(config, "OUTLOOK_URL", "https://outlook.office.com/releve/outlook.html")
    memoire = {"actif-outlook": int(time.time() * 1000)}
    base.outlook_extension_ecrire(compte["id"], coffre.fermer(json.dumps(memoire)))
    client.post("/v1/annuaire/regrouper", headers=compte["h"], json={"objectif": 1000})
    e = attendre(client, compte["h"], "annuaire")
    assert e["statut"] == "fini" and e["message"].startswith("Annuaire parcouru"), e
    assert e["progression"]["releves"] == 38


def test_pause_immediate_puis_reprise(client, compte, monkeypatch):
    monkeypatch.setattr(config, "OUTLOOK_URL", "https://outlook.office.com/releve/outlook.html")
    client.post("/v1/annuaire/regrouper", headers=compte["h"], json={"objectif": 1000})
    fin = time.time() + 120
    while time.time() < fin and not client.get("/v1/travail", headers=compte["h"]).json()["annuaire"].get("progression", {}).get("releves"):
        time.sleep(0.3)
    t0 = time.time()
    assert client.post("/v1/annuaire/arreter", headers=compte["h"]).json() == {"ok": True}
    e = attendre(client, compte["h"], "annuaire")
    assert time.time() - t0 < 30, "la pause doit être prise en compte vite"
    assert e["statut"] == "fini" and e["message"].startswith("Recherche en pause"), e
    avant = e["progression"]["releves"]
    assert avant < 38
    # Reprise : la même liste continue jusqu'au bout de l'annuaire.
    n_avant = client.get("/v1/destinataires", headers=compte["h"]).json()["total"]
    client.post("/v1/annuaire/regrouper", headers=compte["h"], json={"objectif": 1000, "nouvelle": False})
    e = attendre(client, compte["h"], "annuaire")
    assert e["statut"] == "fini" and e["message"].startswith("Annuaire parcouru"), e
    assert client.get("/v1/destinataires", headers=compte["h"]).json()["total"] >= n_avant


def _preparer(compte, n, packs_heure=120, plage=(0, 24)):
    base.destinataires_ajouter(compte["id"], [{"adresse": f"eleve{i}@essca.fr", "nom": f"Élève {i}"} for i in range(1, n + 1)])
    base.parametres_ecrire(compte["id"], {"pack": 20, "attente": 30, "destinataires": 1, "taille_pack": 1, "packs_heure": packs_heure, "max_jour": 400,
                                          "heure_debut": plage[0], "heure_fin": plage[1], "preset": "perso"})


def test_envoi_a_chaque_eleve_une_fois_puis_jamais_deux_fois(client, compte, envoyes):
    _preparer(compte, 3)
    r = client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour,\nInscriptions ouvertes."})
    assert r.status_code == 202, r.text
    e = attendre(client, compte["h"], "envoi")
    assert e["type"] == "envoi" and e["statut"] == "fini", e
    assert e["progression"]["envoyes"] == 3 and e["progression"]["a_verifier"] == 0
    assert [m["a"] for m in envoyes["liste"]] == [["eleve1@essca.fr"], ["eleve2@essca.fr"], ["eleve3@essca.fr"]]
    assert all(m["objet"] == "Certification IA" and "Inscriptions ouvertes." in m["corps"] for m in envoyes["liste"])
    assert all(m["importance"] for m in envoyes["liste"])  # toujours en importance élevée
    # Chaque élève est coché « reçu » dans la liste, et l'app voit les coches arriver.
    assert [x["statut"] for x in client.get("/v1/destinataires", headers=compte["h"]).json()["personnes"]] == ["envoye"] * 3
    s = client.get("/v1/envoi/suivi?depuis=0", headers=compte["h"]).json()
    assert {c["adresse"]: c["statut"] for c in s["changes"]} == {f"eleve{i}@essca.fr": "envoye" for i in (1, 2, 3)} and s["curseur"] > 0

    # Tous sont dans « Reçu » : plus personne à qui envoyer, rien ne part.
    envoyes["liste"] = []
    l = client.get("/v1/destinataires", headers=compte["h"]).json()
    assert l["a_envoyer"] == 0 and l["recus"] == 3
    r = client.post("/v1/envoi", headers=compte["h"], json={"objet": "Encore", "texte": "x"})
    assert r.status_code == 409 and "collectez d'autres élèves" in r.json()["detail"]
    assert envoyes["liste"] == []
    # Une nouvelle recherche ne les retire pas de « Reçu » et ne peut pas les remettre à envoyer.
    base.destinataires_vider(compte["id"])
    assert base.destinataires_ajouter(compte["id"], [{"adresse": "eleve2@essca.fr"}, {"adresse": "eleve9@essca.fr"}]) == 1
    l = client.get("/v1/destinataires", headers=compte["h"]).json()
    assert l["recus"] == 3 and [x["adresse"] for x in l["personnes"] if x["statut"] == ""] == ["eleve9@essca.fr"]
    assert [x["statut"] for x in l["personnes"]] == ["envoye"] * 3 + [""]


def test_envoi_par_packs_avec_pause_entre_les_packs(client, compte, envoyes, monkeypatch):
    """5 élèves, packs de 2, pause entre deux packs : 2 mails, pause, 2 mails, pause, 1 mail."""
    monkeypatch.setattr(travaux, "MINUTE", 1)  # « 10 minutes » = 10 secondes (de la marge sur une machine chargée)
    base.destinataires_ajouter(compte["id"], [{"adresse": f"eleve{i}@essca.fr", "nom": f"Élève {i}"} for i in range(1, 6)])
    assert client.put("/v1/parametres", headers=compte["h"], json={"pack": 2, "attente": 10, "heure_debut": 0, "heure_fin": 24, "destinataires": 1}).status_code == 200
    assert client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour,\nInscriptions ouvertes."}).status_code == 202
    pauses, fin = [], time.time() + 200
    while time.time() < fin:
        e = client.get("/v1/travail", headers=compte["h"]).json()["envoi"]
        pk = (e.get("progression") or {}).get("pack") or {}
        if pk.get("prochain") and "Prochain pack de 2 mails" in e["message"]:
            n = e["progression"]["envoyes"]
            if not pauses or pauses[-1] != n:
                pauses.append(n)
                # Pendant la pause, rien ne part.
                time.sleep(1.5)
                assert client.get("/v1/travail", headers=compte["h"]).json()["envoi"]["progression"]["envoyes"] == n
        if e["statut"] in ("fini", "erreur"):
            break
        time.sleep(0.3)
    assert e["statut"] == "fini", e
    assert pauses == [2, 4], pauses  # une pause après chaque pack de 2
    assert [m["a"] for m in envoyes["liste"]] == [[f"eleve{i}@essca.fr"] for i in range(1, 6)]  # chacun une fois, un mail chacun
    assert client.get("/v1/compte", headers=compte["h"]).json()["parametres"]["pack"] == 2



def test_envoi_en_cci_par_mails_de_plusieurs_destinataires(client, compte, envoyes, monkeypatch):
    """Préréglage en Cci : chaque mail part à « destinataires » élèves au plus, tous en Cci (personne en
    « À », aucun ne voit les autres), par packs de « pack » mails avec la pause entre deux packs ;
    chacun le reçoit une seule fois."""
    monkeypatch.setattr(travaux, "MINUTE", 1)  # « 6 minutes » = 6 secondes
    base.destinataires_ajouter(compte["id"], [{"adresse": f"eleve{i}@essca.fr", "nom": f"Élève {i}"} for i in range(1, 8)])
    r = client.put("/v1/parametres", headers=compte["h"], json={"pack": 2, "attente": 6, "destinataires": 3, "max_jour": 9995,
                                                                 "heure_debut": 0, "heure_fin": 24})
    assert r.status_code == 200 and r.json()["destinataires"] == 3, r.text
    assert client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour"}).status_code == 202
    pauses, fin = [], time.time() + 240
    while time.time() < fin:
        e = client.get("/v1/travail", headers=compte["h"]).json()["envoi"]
        if ((e.get("progression") or {}).get("pack") or {}).get("prochain"):
            n = e["progression"]["envoyes"]
            if not pauses or pauses[-1] != n:
                pauses.append(n)
        if e["statut"] in ("fini", "erreur"):
            break
        time.sleep(0.3)
    assert e["statut"] == "fini", e
    mails = envoyes["liste"]
    assert [len(m["cci"]) for m in mails] == [3, 3, 1] and all(not m["a"] for m in mails), [(m["a"], m["cci"]) for m in mails]
    assert sorted(a for m in mails for a in m["cci"]) == sorted(f"eleve{i}@essca.fr" for i in range(1, 8))  # chacun une fois
    assert pauses == [6], pauses  # une pause après le premier pack (2 mails, 6 élèves)
    assert e["progression"]["envoyes"] == 7

def _suivre_envoi(client, compte, condition, delai=200):
    fin = time.time() + delai
    while time.time() < fin:
        e = client.get("/v1/travail", headers=compte["h"]).json()["envoi"]
        if condition(e) or e["statut"] in ("fini", "erreur", "pause"):
            return e
        time.sleep(0.3)
    raise AssertionError(f"envoi bloqué : {e}")


def test_eleve_non_distribue_l_envoi_continue(client, compte, envoyes, monkeypatch):
    """« Votre message envoyé à … n'a pas pu être remis » (5.1.10) : cet élève est noté
    « non distribué », les autres reçoivent quand même le message."""
    monkeypatch.setattr(travaux, "MINUTE", 1)
    base.destinataires_ajouter(compte["id"], [{"adresse": f"eleve{i}@essca.fr", "nom": f"Élève {i}"} for i in range(1, 5)])
    client.put("/v1/parametres", headers=compte["h"], json={"pack": 2, "attente": 3, "heure_debut": 0, "heure_fin": 24, "destinataires": 1})
    client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour,\nInscriptions ouvertes."})
    _suivre_envoi(client, compte, lambda e: (e.get("progression") or {}).get("envoyes", 0) >= 2)
    envoyes["boite"].append(avis_eleve(1, "eleve2@essca.fr"))
    e = _suivre_envoi(client, compte, lambda e: False)
    assert e["statut"] == "fini", e
    assert e["progression"]["non_distribues"] == 1
    assert len(envoyes["liste"]) == 4  # tout le monde a eu son mail
    statuts = {x["adresse"]: x["statut"] for x in client.get("/v1/destinataires", headers=compte["h"]).json()["personnes"]}
    assert statuts["eleve2@essca.fr"] == "nondistribue" and statuts["eleve3@essca.fr"] == "envoye"


def test_boite_bloquee_l_envoi_se_met_en_pause(client, compte, envoyes, monkeypatch):
    """« Undeliverable … not recognized as a valid sender … 5.1.8 » : la boîte est bloquée,
    plus rien ne part. Un ancien avis, déjà là avant l'envoi, ne compte pas."""
    monkeypatch.setattr(travaux, "MINUTE", 1)
    envoyes["boite"].append(avis_blocage(0, "ancien@essca.fr"))  # d'un envoi d'avant
    base.destinataires_ajouter(compte["id"], [{"adresse": f"eleve{i}@essca.fr", "nom": f"Élève {i}"} for i in range(1, 7)])
    client.put("/v1/parametres", headers=compte["h"], json={"pack": 2, "attente": 30, "heure_debut": 0, "heure_fin": 24, "destinataires": 1})
    client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour,\nInscriptions ouvertes."})
    e = _suivre_envoi(client, compte, lambda e: ((e.get("progression") or {}).get("pack") or {}).get("prochain"))
    assert e["statut"] == "en_cours" and e["progression"]["envoyes"] == 2, e  # le vieil avis n'a rien arrêté
    envoyes["boite"].append(avis_blocage(1, "eleve2@essca.fr"))
    e = _suivre_envoi(client, compte, lambda e: False, delai=60)
    assert e["statut"] == "pause" and e["progression"].get("blocage") and "5.1.8" in e["message"], e
    assert len(envoyes["liste"]) == 2  # plus rien n'est parti
    # Un pack à la fois dans le panneau : les 4 autres élèves attendent la reprise dans « À envoyer ».
    assert base.destinataires_compter(compte["id"], "a_envoyer") == 4
    # Règle pour TOUTES les écoles : reprise automatique 24 h plus tard, au rythme d'IESEG et SKEMA (90/jour).
    for _ in range(60):
        t = base.travail_lire(compte["id"], "envoi")
        if t["statut"] == "attente":
            break
        time.sleep(0.5)
    assert t["statut"] == "attente" and "programmé" in t["message"], t["message"]
    assert abs(float(t["params"]["debut"]) - (time.time() + 24 * 3600)) < 300
    pr = t["params"]["parametres"]
    assert (pr["pack"], pr["destinataires"], pr["max_jour"]) == (1, 90, 90)
    assert base.parametres_lire(compte["id"])["max_jour"] == 90 and len(envoyes["liste"]) == 2  # rien de plus n'est parti
    client.post("/v1/envoi/arreter", headers=compte["h"])


def test_pause_a_tout_moment_pendant_les_packs(client, compte, envoyes, monkeypatch):
    """Pause pendant l'attente entre deux packs : prise tout de suite, rien ne part.
    « Reprendre l'envoi » : le pack suivant part, chacun reçoit le message une fois."""
    monkeypatch.setattr(travaux, "MINUTE", 1)
    base.destinataires_ajouter(compte["id"], [{"adresse": f"eleve{i}@essca.fr", "nom": f"Élève {i}"} for i in range(1, 5)])
    client.put("/v1/parametres", headers=compte["h"], json={"pack": 2, "attente": 60, "heure_debut": 0, "heure_fin": 24, "destinataires": 1})
    client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour,\nInscriptions ouvertes."})
    e = _suivre_envoi(client, compte, lambda e: ((e.get("progression") or {}).get("pack") or {}).get("prochain"))
    assert e["statut"] == "en_cours" and len(envoyes["liste"]) == 2, e
    t0 = time.time()
    assert client.post("/v1/envoi/arreter", headers=compte["h"]).json() == {"ok": True}
    e = attendre(client, compte["h"], "envoi", delai=30)
    assert e["statut"] == "pause" and time.time() - t0 < 30, e  # tout de suite, même pendant l'attente
    time.sleep(2)
    avant = [m["a"] for m in envoyes["liste"]]
    assert len(avant) == 2  # rien ne part pendant la pause
    envoyes["liste"] = []  # la reprise ouvre un nouveau navigateur (sa page note ses propres mails)
    assert client.post("/v1/envoi/reprendre", headers=compte["h"]).status_code == 202
    e = _suivre_envoi(client, compte, lambda e: ((e.get("progression") or {}).get("pack") or {}).get("prochain")
                      and (e.get("progression") or {}).get("envoyes") == 4)
    apres = [m["a"] for m in envoyes["liste"]]
    assert avant + apres == [[f"eleve{i}@essca.fr"] for i in range(1, 5)]  # chacun une fois, rien de renvoyé
    client.post("/v1/envoi/arreter", headers=compte["h"])
    attendre(client, compte["h"], "envoi", delai=30)


def test_pause_pendant_l_attente_de_la_recherche(client, compte, envoyes, monkeypatch):
    """Envoi continu en attente des élèves de la recherche : on peut le mettre en pause ;
    à la reprise, les élèves trouvés entre-temps partent à leur tour."""
    monkeypatch.setattr(travaux, "MINUTE", 1)
    recherche = {"en_cours": True}
    vrai = travaux.en_cours
    monkeypatch.setattr(travaux, "en_cours",
                        lambda uid, type_: (True if recherche["en_cours"] else None) if type_ == "annuaire" else vrai(uid, type_))
    base.destinataires_ajouter(compte["id"], [{"adresse": "eleve1@essca.fr", "nom": "Élève 1"}])
    client.put("/v1/parametres", headers=compte["h"], json={"pack": 20, "attente": 1, "heure_debut": 0, "heure_fin": 24, "destinataires": 1})
    client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour,\nInscriptions ouvertes."})
    _suivre_envoi(client, compte, lambda e: "La recherche continue" in (e.get("message") or ""))
    client.post("/v1/envoi/arreter", headers=compte["h"])
    e = attendre(client, compte["h"], "envoi", delai=30)
    assert e["statut"] == "pause", e
    base.destinataires_ajouter(compte["id"], [{"adresse": "eleve2@essca.fr", "nom": "Élève 2"}])  # trouvé pendant la pause
    time.sleep(2)
    avant = [m["a"] for m in envoyes["liste"]]
    assert avant == [["eleve1@essca.fr"]]  # rien ne part pendant la pause
    envoyes["liste"] = []
    recherche["en_cours"] = False
    assert client.post("/v1/envoi/reprendre", headers=compte["h"]).status_code == 202
    e = attendre(client, compte["h"], "envoi", delai=90)
    assert e["statut"] == "fini" and e["progression"]["envoyes"] == 2, e
    assert avant + [m["a"] for m in envoyes["liste"]] == [["eleve1@essca.fr"], ["eleve2@essca.fr"]]


def test_retirer_de_la_liste_pendant_un_envoi(client, compte, envoyes, monkeypatch):
    """« Retirer de la liste » pendant un envoi : l'élève retiré n'est jamais envoyé (la
    campagne en cours le saute) et ne compte pas comme servi. Rajouté depuis « Exclus », il
    reçoit le message au prochain envoi, une seule fois."""
    monkeypatch.setattr(travaux, "MINUTE", 1)
    base.destinataires_ajouter(compte["id"], [{"adresse": f"eleve{i}@essca.fr", "nom": f"Élève {i}"} for i in (1, 2, 3)])
    client.put("/v1/parametres", headers=compte["h"], json={"pack": 1, "attente": 4, "heure_debut": 0, "heure_fin": 24, "destinataires": 1})
    client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour,\nInscriptions ouvertes."})
    _suivre_envoi(client, compte, lambda e: ((e.get("progression") or {}).get("pack") or {}).get("prochain")
                  and (e.get("progression") or {}).get("envoyes") == 1)
    r = client.post("/v1/destinataires/retirer", headers=compte["h"], json={"adresses": ["eleve2@essca.fr", "eleve1@essca.fr"]}).json()
    assert r["retires"] == 1  # eleve1 a déjà reçu : jamais retiré
    e = attendre(client, compte["h"], "envoi", delai=120)
    assert e["statut"] == "fini", e
    assert [m["a"] for m in envoyes["liste"]] == [["eleve1@essca.fr"], ["eleve3@essca.fr"]]  # eleve2 sauté
    x = client.get("/v1/exclus?genre=retire", headers=compte["h"]).json()
    assert [p["adresse"] for p in x["personnes"]] == ["eleve2@essca.fr"]
    assert not base.cnx().execute("SELECT 1 FROM contactes WHERE adresse = 'eleve2@essca.fr'").fetchone()  # pas « servi »
    # Rajouté : il reçoit le message au prochain envoi (et une seule fois).
    envoyes["liste"] = []
    assert client.post("/v1/exclus/ajouter", headers=compte["h"], json={"adresses": ["eleve2@essca.fr"]}).json()["ajoutes"] == 1
    client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour,\nInscriptions ouvertes."})
    e = attendre(client, compte["h"], "envoi", delai=120)
    assert e["statut"] == "fini" and [m["a"] for m in envoyes["liste"]] == [["eleve2@essca.fr"]], (e, envoyes["liste"])


def test_retirer_l_acces_garde_la_recherche(client, compte):
    """« Retirer l'accès à Outlook » : la session est oubliée, la mémoire de la recherche reste
    et revient à la reconnexion (cas réel SNHU : tout avait été perdu)."""
    memoire = {"mega-annuaire": "a@essca.fr\nb@essca.fr", "reprise-outlook": "point de reprise"}
    base.outlook_extension_ecrire(compte["id"], coffre.fermer(json.dumps(memoire)))
    assert client.delete("/v1/outlook", headers=compte["h"]).status_code == 200
    assert base.outlook_lire(compte["id"]) is None  # plus de session
    ligne = base.cnx().execute("SELECT extension FROM outlook WHERE utilisateur_id = ?", (compte["id"],)).fetchone()
    assert json.loads(coffre.ouvrir(ligne[0])) == memoire  # la recherche est gardée
    base.outlook_ecrire(compte["id"], "lea@essca.fr", coffre.fermer(json.dumps({"cookies": [{"name": "x"}]})))  # reconnexion
    assert json.loads(coffre.ouvrir(base.outlook_lire(compte["id"])["extension"])) == memoire


def test_capacite_par_jour_des_packs():
    assert travaux.capacite_jour({"pack": 20, "attente": 30, "heure_debut": 8, "heure_fin": 20}) == 20 * ((12 * 3600 + 1800) // (500 + 1800))
    assert travaux.capacite_jour({"pack": 500, "attente": 1, "heure_debut": 0, "heure_fin": 24, "destinataires": 1}) <= 9995
    # En Cci : 2 mails de 495 destinataires par pack, jamais plus que le maximum par jour de la messagerie.
    assert travaux.capacite_jour({"pack": 2, "attente": 70, "destinataires": 495, "max_jour": 9995, "heure_debut": 8, "heure_fin": 20}) == 9900
    assert travaux.capacite_jour({"pack": 10, "attente": 5, "destinataires": 495, "max_jour": 2995, "heure_debut": 8, "heure_fin": 20}) == 2995


def test_hors_plage_horaire_rien_ne_part(client, compte, envoyes):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    h = datetime.now(ZoneInfo(config.FUSEAU)).hour
    debut = (h + 2) % 24
    _preparer(compte, 2, plage=(debut, debut + 1) if debut < 23 else (1, 2))
    client.post("/v1/envoi", headers=compte["h"], json={"objet": "Hors plage", "texte": "x"})
    fin = time.time() + 30
    while time.time() < fin and "plage horaire" not in client.get("/v1/travail", headers=compte["h"]).json()["envoi"]["message"]:
        time.sleep(0.5)
    time.sleep(3)
    e = client.get("/v1/travail", headers=compte["h"]).json()["envoi"]
    assert e["statut"] == "en_cours" and "plage horaire" in e["message"], e
    assert envoyes["liste"] == []
    assert client.post("/v1/envoi/arreter", headers=compte["h"]).json() == {"ok": True}
    assert attendre(client, compte["h"], "envoi")["statut"] == "pause"


def test_serveur_redemarre_en_plein_envoi_personne_deux_fois(client, compte, envoyes):
    _preparer(compte, 3, packs_heure=6)  # ~5 s entre deux mails en mode accéléré
    client.post("/v1/envoi", headers=compte["h"], json={"objet": "Reprise", "texte": "x"})
    fin = time.time() + 90
    while time.time() < fin and len(envoyes["liste"]) < 1:
        time.sleep(0.3)
    assert len(envoyes["liste"]) == 1
    deja = list(envoyes["liste"])
    # Le serveur s'arrête (mise à jour, redémarrage) : le travail reste « en cours » en base…
    client.portal.call(travaux.fermer_tout)
    assert base.travail_lire(compte["id"], "envoi")["statut"] == "en_cours"
    # …et repart tout seul au démarrage suivant, là où il en était.
    client.portal.call(travaux.reprendre_apres_redemarrage)
    e = attendre(client, compte["h"], "envoi", delai=180)
    assert e["statut"] == "fini", e
    tous = deja + envoyes["liste"]  # la page repart à zéro : on ajoute ce qu'elle a envoyé depuis
    adresses = [m["a"][0] for m in tous]
    assert sorted(adresses) == ["eleve1@essca.fr", "eleve2@essca.fr", "eleve3@essca.fr"], adresses
    p = e["progression"]
    assert p["envoyes"] + p["a_verifier"] + p["deja"] == 3, json.dumps(p)



def test_envoi_programme_attend_son_heure_sans_navigateur(client, compte, envoyes):
    """Un envoi programmé attend l'heure choisie sans ouvrir de navigateur ; il survit à un
    redémarrage du serveur ; on peut l'annuler (rien n'est parti) ou le faire partir tout de
    suite ; ensuite chaque élève le reçoit une seule fois."""
    _preparer(compte, 2)
    h = compte["h"]
    assert client.post("/v1/envoi/programmer", headers=h, json={}).status_code == 409  # rien de programmé
    r = client.post("/v1/envoi", headers=h, json={"objet": "Bonjour", "texte": "Texte", "debut": time.time() + 100 * 86400})
    assert r.status_code == 422  # au plus 90 jours à l'avance
    debut = time.time() + 3600
    assert client.post("/v1/envoi", headers=h, json={"objet": "Bonjour", "texte": "Texte", "debut": debut}).status_code == 202
    time.sleep(1)
    e = client.get("/v1/travail", headers=h).json()["envoi"]
    assert e["statut"] == "attente" and abs(e["progression"]["programme"] - debut) < 1 and "programmé" in e["message"], e
    assert travaux.charge()["navigateurs"] == 0 and not envoyes["liste"]
    # Redémarrage du serveur : l'envoi attend toujours son heure.
    client.portal.call(travaux.fermer_tout)
    client.portal.call(travaux.reprendre_apres_redemarrage)
    time.sleep(1)
    e = client.get("/v1/travail", headers=h).json()["envoi"]
    assert e["statut"] == "attente" and abs(e["progression"]["programme"] - debut) < 1, e
    # Annuler : rien n'est parti.
    assert client.post("/v1/envoi/arreter", headers=h).json() == {"ok": True}
    e = attendre(client, h, "envoi")
    assert e["statut"] == "pause" and "annulée" in e["message"] and not envoyes["liste"], e
    # Programmé de nouveau, puis « Commencer maintenant » : il part, une fois chacun.
    assert client.post("/v1/envoi", headers=h, json={"objet": "Bonjour", "texte": "Texte", "debut": time.time() + 7200}).status_code == 202
    time.sleep(1)
    assert client.post("/v1/envoi/programmer", headers=h, json={}).status_code == 200
    e = attendre(client, h, "envoi", delai=240)
    assert e["statut"] == "fini", e
    assert sorted(m["a"][0] for m in envoyes["liste"]) == ["eleve1@essca.fr", "eleve2@essca.fr"]
    textes = [x["texte"] for x in base.journal_lire(compte["id"], taille=30)]
    assert any(x.startswith("Envoi programmé le ") for x in textes) and "Envoi programmé : départ avancé à maintenant." in textes, textes


def test_objectif_change_pendant_la_recherche_et_garde_pour_la_reprise(client, compte, monkeypatch):
    """L'objectif se change à tout moment : pendant la recherche (elle s'arrête au nouveau
    nombre), et sans recherche en cours (gardé pour la reprise). Jamais de limite haute."""
    monkeypatch.setattr(config, "OUTLOOK_URL", "https://outlook.office.com/releve/outlook.html")
    h = compte["h"]
    assert client.post("/v1/annuaire/regrouper", headers=h, json={"objectif": 100000, "nouvelle": True}).status_code == 202
    fin = time.time() + 120
    while time.time() < fin and not client.get("/v1/travail", headers=h).json()["annuaire"]["progression"].get("trouves"):
        time.sleep(0.3)
    r = client.put("/v1/annuaire/objectif", headers=h, json={"objectif": 2})
    assert r.status_code == 200 and r.json()["progression"]["objectif"] == 2, r.text
    e = attendre(client, h, "annuaire", delai=240)
    assert e["statut"] == "fini" and e["message"].startswith("Objectif atteint"), e
    r = client.put("/v1/annuaire/objectif", headers=h, json={"objectif": 1_000_000})
    assert r.json()["progression"]["objectif"] == 1_000_000
    assert base.travail_lire(compte["id"], "annuaire")["params"]["objectif"] == 1_000_000
    assert client.put("/v1/annuaire/objectif", headers=h, json={"objectif": 0}).status_code == 422


def test_tri_refuse_quand_la_recherche_trie_deja(client, compte, monkeypatch):
    """Logique apprise et recherche en cours : elle trie déjà chaque nouveau contact, relancer
    « Garder seulement les étudiants » réapprendrait la logique pour rien (crédits) : refusé."""
    base.extraits_ajouter(compte["id"], [{"adresse": "a.b@essca.fr", "nom": "A B"}])
    monkeypatch.setattr(travaux, "en_cours", lambda u, ty: object() if ty == "annuaire" else None)
    monkeypatch.setattr(base, "logique_lire", lambda u: {"resume": "x"})
    r = client.post("/v1/tri/lancer", headers=compte["h"])
    assert r.status_code == 409 and "automatiquement" in r.json()["detail"], r.text


def test_recherche_rattrape_les_contacts_extraits_sans_tri(client, compte, monkeypatch):
    """La logique de l'école apparaît pendant une extraction (comme après « Garder seulement les
    étudiants ») : la recherche trie alors aussi les contacts extraits avant, sans relancer de tri."""
    from app import logique as logique_mod
    monkeypatch.setattr(config, "OUTLOOK_URL", "https://outlook.office.com/releve/outlook.html")
    uid, h = compte["id"], compte["h"]
    assert client.post("/v1/annuaire/regrouper", headers=h, json={"objectif": 100000, "nouvelle": True, "extraction": True}).status_code == 202
    fin = time.time() + 120
    while time.time() < fin and base.extraits_compter(uid) < 20:
        time.sleep(0.3)
    lg, _, _ = logique_mod.apprenti().apprendre_global(base.extraits_lister(uid, 0, 100000))
    base.logique_ecrire(uid, lg.model_dump())
    e = attendre(client, h, "annuaire", delai=240)
    assert e["statut"] == "fini", e
    assert base.extraits_compter(uid, non_tries=True) == 0, (base.extraits_compter(uid), base.extraits_compter(uid, non_tries=True))
    assert base.destinataires_compter(uid) >= 1

def test_sans_session_outlook_ou_sans_eleves(client):
    jeton, u = base.connexion_par_email("tom@essca.fr")
    h = {"Authorization": "Bearer " + jeton}
    r = client.post("/v1/annuaire/regrouper", headers=h, json={"objectif": 10})
    assert r.status_code == 409 and "reconnectez-vous" in r.json()["detail"]
    base.outlook_ecrire(u["id"], "tom@essca.fr", coffre.fermer("{}"))
    r = client.post("/v1/envoi", headers=h, json={"objet": "x", "texte": "y"})
    assert r.status_code == 409 and "collectez d'autres élèves" in r.json()["detail"]
    assert client.post("/v1/envoi/reprendre", headers=h).status_code == 409


def test_message_test_a_soi_meme_puis_vrai_envoi(client, compte, envoyes):
    _preparer(compte, 2)
    for i in range(2):  # on peut tester autant de fois qu'on veut
        envoyes["liste"] = []
        r = client.post("/v1/envoi/test", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour"})
        assert r.status_code == 202, r.text
        e = attendre_test(client, compte["h"])
        assert e["statut"] == "fini", e
        assert e["message"] == "Message test envoyé à lea@essca.fr. Regardez votre boîte de réception."
        assert [m["a"] for m in envoyes["liste"]] == [["lea@essca.fr"]]  # à soi-même, à personne d'autre
        assert envoyes["liste"][0]["objet"] == "[Test] Certification IA"
        assert envoyes["liste"][0]["importance"]  # importance élevée
    # Le vrai envoi ensuite : les deux élèves, une fois chacun.
    envoyes["liste"] = []
    client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour"})
    e = attendre(client, compte["h"], "envoi")
    assert e["type"] == "envoi" and e["statut"] == "fini", e
    assert [m["a"] for m in envoyes["liste"]] == [["eleve1@essca.fr"], ["eleve2@essca.fr"]]


def attendre_test(client, h, delai=150):
    fin = time.time() + delai
    while time.time() < fin:
        e = client.get("/v1/envoi/test", headers=h).json()
        if e["statut"] in ("fini", "erreur"):
            return e
        time.sleep(0.5)
    raise AssertionError(f"test bloqué : {e}")


def test_tester_pendant_un_envoi_en_cours(client, compte, envoyes):
    """Un test à tout moment : pendant un envoi, il part à soi-même, et l'envoi aux
    élèves continue sans rien perdre (personne deux fois, personne oublié)."""
    _preparer(compte, 3, packs_heure=6)  # ~5 s entre deux mails en mode accéléré
    client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour"})
    fin = time.time() + 90
    while time.time() < fin and len(envoyes["liste"]) < 1:
        time.sleep(0.3)
    r = client.post("/v1/envoi/test", headers=compte["h"], json={"objet": "Essai", "texte": "Coucou"})
    assert r.status_code == 202, r.text
    assert client.post("/v1/envoi/test", headers=compte["h"], json={"objet": "x", "texte": "y"}).status_code == 409  # un test à la fois
    assert attendre_test(client, compte["h"])["message"].startswith("Message test envoyé à lea@essca.fr")
    e = attendre(client, compte["h"], "envoi", delai=180)
    assert e["type"] == "envoi" and e["statut"] == "fini", e
    p = e["progression"]
    assert p["total"] == 3 and p["envoyes"] + p["a_verifier"] + p["deja"] == 3, json.dumps(p)
    o = base.outlook_lire(compte["id"])
    memoire = json.loads(coffre.ouvrir(o["extension"]))
    assert memoire["pp-campagne"]["total"] == 3  # la campagne de l'envoi, jamais écrasée par celle du test
    assert "lea@essca.fr" not in [a.lower() for a in memoire.get("pp-deja", [])]



def test_envoyer_pendant_la_recherche(client, compte, envoyes, monkeypatch):
    """À tout moment de la recherche : l'étudiant lance l'envoi aux élèves déjà trouvés,
    la recherche continue, et l'envoi continue avec ceux qu'elle trouve ensuite. Les deux
    tournent ensemble, aucun n'écrase l'autre, et chacun reçoit le message une seule fois."""
    _preparer(compte, 2, packs_heure=120)
    monkeypatch.setattr(config, "OUTLOOK_URL", "https://outlook.office.com/releve/outlook.html")
    client.post("/v1/annuaire/regrouper", headers=compte["h"], json={"objectif": 1000, "nouvelle": False})
    fin = time.time() + 120  # la recherche lit vraiment l'annuaire
    while time.time() < fin and not client.get("/v1/travail", headers=compte["h"]).json()["annuaire"]["progression"].get("releves"):
        time.sleep(0.3)
    # Pendant la recherche : l'envoi part (la page d'envoi sert de messagerie).
    monkeypatch.setattr(config, "OUTLOOK_URL", "https://outlook.office.com/mail/")
    r = client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour"})
    assert r.status_code == 202, r.text
    r2 = client.post("/v1/envoi", headers=compte["h"], json={"objet": "x", "texte": "y"})
    assert r2.status_code == 409 and "automatiquement" in r2.json()["detail"]  # un seul envoi, qui prend la suite
    t = client.get("/v1/travail", headers=compte["h"]).json()
    assert t["annuaire"]["actif"] and t["envoi"]["statut"] in ("attente", "en_cours")  # les deux ensemble
    a = attendre(client, compte["h"], "annuaire", delai=240)
    assert a["statut"] == "fini", a
    e = attendre(client, compte["h"], "envoi", delai=240)
    assert e["statut"] == "fini" and e["message"].startswith("Terminé"), e
    l = client.get("/v1/destinataires", headers=compte["h"]).json()
    adresses = [m["a"][0] for m in envoyes["liste"]]
    assert {"eleve1@essca.fr", "eleve2@essca.fr"} <= set(adresses)  # (envoi par ordre alphabétique, pas d'ordre de découverte)
    assert len(adresses) == len(set(adresses)) == l["total"] == l["recus"], (adresses, l["total"])  # tout le monde, une fois
    assert e["progression"]["envoyes"] == l["total"]
    # Les deux mémoires sont là : la campagne de l'envoi ET l'annuaire de la recherche.
    memoire = json.loads(coffre.ouvrir(base.outlook_lire(compte["id"])["extension"]))
    assert memoire.get("pp-campagne") and memoire.get("mega-annuaire") and memoire.get("pp-deja")
    # Relancer : plus personne à qui envoyer.
    r = client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour"})
    assert r.status_code == 409


def test_envoi_continu_avec_les_eleves_trouves_ensuite(client, compte, envoyes, monkeypatch):
    """L'envoi part aux 2 premiers élèves ; la recherche (toujours en cours) en trouve 2
    autres : ils partent à leur tour, après la pause du pack. L'envoi ne se termine que
    quand la recherche est finie. Personne ne reçoit deux fois."""
    monkeypatch.setattr(travaux, "MINUTE", 1)
    recherche = {"en_cours": True}
    vrai = travaux.en_cours
    monkeypatch.setattr(travaux, "en_cours",
                        lambda uid, type_: (True if recherche["en_cours"] else None) if type_ == "annuaire" else vrai(uid, type_))
    base.destinataires_ajouter(compte["id"], [{"adresse": f"eleve{i}@essca.fr", "nom": f"Élève {i}"} for i in (1, 2)])
    client.put("/v1/parametres", headers=compte["h"], json={"pack": 20, "attente": 2, "heure_debut": 0, "heure_fin": 24, "destinataires": 1})
    client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour,\nInscriptions ouvertes."})
    e = _suivre_envoi(client, compte, lambda e: "La recherche continue" in (e.get("message") or ""))
    assert e["statut"] == "en_cours" and len(envoyes["liste"]) == 2, e  # en attente des suivants
    base.destinataires_ajouter(compte["id"], [{"adresse": f"eleve{i}@essca.fr", "nom": f"Élève {i}"} for i in (3, 4)])
    e = _suivre_envoi(client, compte, lambda e: (e.get("progression") or {}).get("envoyes") == 4 and "La recherche continue" in (e.get("message") or ""))
    assert e["statut"] == "en_cours", e
    recherche["en_cours"] = False  # la recherche est finie
    e = attendre(client, compte["h"], "envoi", delai=60)
    assert e["statut"] == "fini" and e["message"] == "Terminé : 4 élèves ont reçu le message.", e
    assert [m["a"] for m in envoyes["liste"]] == [[f"eleve{i}@essca.fr"] for i in (1, 2, 3, 4)]  # chacun une fois, dans l'ordre
    statuts = {x["adresse"]: x["statut"] for x in client.get("/v1/destinataires", headers=compte["h"]).json()["personnes"]}
    assert set(statuts.values()) == {"envoye"}


def test_date_limite_a_j_plus_6():
    from datetime import datetime
    assert travaux.date_limite(datetime(2026, 11, 8, 10, 0)) == "November 14"           # le 8 → avant le 14
    assert travaux.date_limite_fr(datetime(2026, 11, 8, 10, 0)) == "samedi 14 novembre"
    assert travaux.date_limite(datetime(2026, 12, 28, 10, 0)) == "January 3"             # change de mois et d'année
    assert travaux.personnaliser("enroll before {date}.", datetime(2026, 11, 8)) == "enroll before November 14."
    d = datetime(2026, 11, 8)
    assert travaux.personnaliser("{date}", d, "fr") == "14 novembre"
    assert travaux.personnaliser("{date}", d, "es") == "14 de noviembre"
    assert travaux.personnaliser("{date}", d, "de") == "14. November"
    assert travaux.personnaliser("{date}", d, "it") == "14 novembre"
    assert travaux.personnaliser("{date}", d, "xx") == "November 14"  # langue inconnue : anglais


def test_statut_des_eleves_jamais_decoche():
    u, _ = base.compte_outlook("statut@essca.fr")
    base.destinataires_ajouter(u["id"], [{"adresse": "Anna.B@essca.fr", "nom": "Anna"}, {"adresse": "tom@essca.fr", "nom": "Tom"}])
    assert base.destinataires_statuer(u["id"], {"ANNA.B@essca.fr": "envoi"}) == 1  # sans tenir compte de la casse
    changes, curseur = base.destinataires_suivi(u["id"], 0)
    assert changes == [{"adresse": "anna.b@essca.fr", "statut": "envoi"}]
    base.destinataires_statuer(u["id"], {"anna.b@essca.fr": "envoye", "tom@essca.fr": "deja"})
    changes, curseur2 = base.destinataires_suivi(u["id"], curseur)
    assert {c["adresse"]: c["statut"] for c in changes} == {"anna.b@essca.fr": "envoye", "tom@essca.fr": "deja"} and curseur2 >= curseur
    # Un envoi suivant qui la saute (« déjà reçu ») ne décoche pas celle qui l'a reçu.
    assert base.destinataires_statuer(u["id"], {"anna.b@essca.fr": "deja"}) == 0
    assert [x["statut"] for x in base.destinataires_lister(u["id"])] == ["envoye", "deja"]


def test_message_en_html_avec_liens():
    h = travaux.en_html("Dear <Students>,\n\n[GET YOUR REETMA AI CERTIFICATION](https://reetma-agency.com/school)\n"
                        "Reserve your place → https://reetma-agency.com/school")
    assert h.startswith("<div>Dear &lt;Students&gt;,</div><div><br></div>")
    assert '<a href="https://reetma-agency.com/school">GET YOUR REETMA AI CERTIFICATION</a>' in h
    assert 'Reserve your place → <a href="https://reetma-agency.com/school">https://reetma-agency.com/school</a>' in h
    assert "javascript:" not in travaux.en_html("[x](javascript:alert(1))") or "<a" not in travaux.en_html("[x](javascript:alert(1))")


def test_jamais_deux_ambassadeurs_pour_la_meme_personne(client, compte, envoyes):
    """Un élève servi par un ambassadeur n'est plus jamais collecté ni contacté par un autre."""
    _preparer(compte, 2)
    assert client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour,\nInscriptions ouvertes."}).status_code == 202
    assert attendre(client, compte["h"], "envoi")["statut"] == "fini"
    b, _ = base.compte_outlook("tom@essca.fr")
    # La collecte de l'autre ambassadeur ne les reprend pas.
    gardes, contactes = base.destinataires_nouveaux(b["id"], [{"adresse": "eleve1@essca.fr"}, {"adresse": "nouveau@essca.fr"}])
    assert [g["adresse"] for g in gardes] == ["nouveau@essca.fr"] and contactes == 1
    assert base.destinataires_ajouter(b["id"], [{"adresse": "ELEVE2@essca.fr"}, {"adresse": "nouveau@essca.fr"}]) == 1
    # Réservation : un élève dans l'envoi en cours d'un ambassadeur est « pris » pour l'autre.
    assert base.reserver(b["id"], ["nouveau@essca.fr"]) == set()
    assert base.reserver(compte["id"], ["nouveau@essca.fr", "autre@essca.fr"]) == {"nouveau@essca.fr"}
    # Une nouvelle recherche libère ce qui n'est pas parti.
    base.destinataires_vider(b["id"])
    assert base.reserver(compte["id"], ["nouveau@essca.fr"]) == set()


def test_eleve_deja_contacte_par_un_autre_passe_dans_recu(client, compte, envoyes):
    _preparer(compte, 2)
    b, _ = base.compte_outlook("tom@essca.fr")
    base.marquer_recus(b["id"], ["eleve1@essca.fr"])  # entre-temps, un autre ambassadeur l'a servi
    assert client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour,\nInscriptions ouvertes."}).status_code == 202
    assert attendre(client, compte["h"], "envoi")["statut"] == "fini"
    assert [m["a"] for m in envoyes["liste"]] == [["eleve2@essca.fr"]]  # jamais deux fois
    statuts = {x["adresse"]: x["statut"] for x in client.get("/v1/destinataires", headers=compte["h"]).json()["personnes"]}
    assert statuts == {"eleve1@essca.fr": "pris", "eleve2@essca.fr": "envoye"}


def test_message_en_francais(client, compte, envoyes):
    _preparer(compte, 1)
    client.post("/v1/envoi", headers=compte["h"], json={"objet": "Inscrivez-vous avant le {date}", "langue": "fr",
                                                         "texte": "[OBTENEZ VOTRE CERTIFICATION IA REETMA](https://reetma-agency.com/school)"})
    e = attendre(client, compte["h"], "envoi")
    assert e["statut"] == "fini", e
    m = envoyes["liste"][0]
    assert m["objet"] == "Inscrivez-vous avant le " + travaux.date_limite(langue="fr")
    assert ">OBTENEZ VOTRE CERTIFICATION IA REETMA</a>" in m["html"]
    assert client.post("/v1/envoi/test", headers=compte["h"], json={"objet": "x", "texte": "y", "langue": "zz"}).status_code == 422


def test_le_message_reetma_part_tel_quel(client, compte, envoyes):
    _preparer(compte, 1)
    texte = ("Dear Students,\n\nAI is becoming one of the most valuable skills employers look for: enroll before {date}.\n\n"
             "[GET YOUR REETMA AI CERTIFICATION](https://reetma-agency.com/school)\n\n"
             "Places are limited. Reserve your place and start the certification → https://reetma-agency.com/school\n\n"
             "Best regards,\nReetma Agency")
    client.post("/v1/envoi", headers=compte["h"], json={"objet": "Reetma AI Certification: enroll before {date}", "texte": texte})
    e = attendre(client, compte["h"], "envoi")
    assert e["statut"] == "fini", e
    m, d = envoyes["liste"][0], travaux.date_limite()
    assert m["objet"] == "Reetma AI Certification: enroll before " + d and m["importance"]
    assert "enroll before " + d + "." in m["corps"] and "{date}" not in m["corps"]
    assert 'href="https://reetma-agency.com/school"' in m["html"] and ">GET YOUR REETMA AI CERTIFICATION</a>" in m["html"]
    assert "[GET YOUR" not in m["corps"]  # la syntaxe du lien ne se voit pas dans le mail



def test_lien_mort_detecte():
    """Un lien qui ne répond pas (rien n'écoute, domaine inexistant) est repéré avant l'envoi."""
    assert travaux.lien_mort("Bonjour, voir http://127.0.0.1:9/school") == "http://127.0.0.1:9/school"
    assert travaux.lien_mort("[S'inscrire](https://domaine-qui-n-existe-pas-smartmail.invalid/school).") == "https://domaine-qui-n-existe-pas-smartmail.invalid/school"
    assert travaux.lien_mort("Aucun lien ici.") == ""



def test_ordre_alphabetique_et_deja_contactes(compte):
    """Envoi dans l'ordre prénom puis nom ; tout ce qui va jusqu'à la borne (déjà contacté par
    l'ambassadeur) passe dans « Reçu » sans jamais être envoyé."""
    uid = compte["id"]
    base.destinataires_ajouter(uid, [{"adresse": a, "nom": ""} for a in ("zoe.martin@essca.fr", "alice.durand@essca.fr", "marc.petit@essca.fr", "bruno.leroy@essca.fr")])
    base.parametres_ecrire(uid, {"deja_jusqua": "bruno.leroy"})
    assert travaux._choisir_eleves(uid) == ["marc.petit@essca.fr", "zoe.martin@essca.fr"]
    recus = {d["adresse"]: d["statut"] for d in base.destinataires_lister(uid, 0, 10, "recus")}
    assert recus == {"alice.durand@essca.fr": "deja", "bruno.leroy@essca.fr": "deja"}


def test_envoi_attend_la_reconnexion_puis_part_tout_seul(client, compte, envoyes):
    """McGill : l'heure arrive sans session. L'envoi attend (aucune erreur, rien à relancer) ; dès que
    l'ambassadeur se reconnecte, il part tout seul, au rythme prévu."""
    uid = compte["id"]
    base.destinataires_ajouter(uid, [{"adresse": f"eleve{i}@essca.fr", "nom": f"Élève {i}"} for i in range(1, 3)])
    client.put("/v1/parametres", headers=compte["h"], json={"pack": 1, "attente": 30, "heure_debut": 0, "heure_fin": 24, "destinataires": 2})
    # Programmé quand la session existait ; elle est perdue avant l'heure de départ.
    r = client.post("/v1/envoi", headers=compte["h"], json={"objet": "Certification IA", "texte": "Bonjour,\nInscriptions ouvertes.",
                                                            "debut": time.time() + 35})
    assert r.status_code < 300, r.text
    base.outlook_oublier(uid)
    for _ in range(240):
        t = base.travail_lire(uid, "envoi")
        if "reconnexion" in (t["message"] or ""):
            break
        time.sleep(0.25)
    assert t["statut"] == "attente" and "reconnexion" in t["message"], t["message"]
    assert envoyes["liste"] == []
    rowid = base.sessions_archivees(uid)[0][0]
    base.session_restaurer(uid, rowid)  # l'ambassadeur se reconnecte
    e = _suivre_envoi(client, compte, lambda e: (e.get("progression") or {}).get("envoyes", 0) >= 1, delai=120)
    assert e["progression"]["envoyes"] >= 1 and len(envoyes["liste"]) == 1, e
