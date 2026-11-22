"""Le parcours complet de l'étudiant, dans l'app (format iPhone), contre le vrai
serveur qui pilote la vraie extension dans Outlook (simulé par les fausses pages) :
lancer la recherche, la suspendre, la reprendre, voir toutes les adresses, s'envoyer
un test, revenir à la collecte, lancer l'envoi et le voir se terminer."""

import json
import os
import socket
import threading
import time

import pytest
import uvicorn

from app import base, coffre, config, service, travaux
from app.ia import FauxClasseur
from app.main import app
from test_travaux import BOOK, PAGE_ENVOI, PAGE_RELEVE


@pytest.fixture
def serveur(monkeypatch):
    monkeypatch.setattr(config, "FAUX_CLAUDE", True)
    monkeypatch.setattr(config, "DEMO", False)
    monkeypatch.setattr(config, "OUTLOOK_ARRIVEE", ["https://outlook.office.com/"])
    monkeypatch.setattr(config, "OUTLOOK_URL", "https://outlook.office.com/releve/outlook.html")
    monkeypatch.setattr(config, "PAS_SUIVI", 0.5)
    service.definir_classeur(FauxClasseur())
    envoyes = {"liste": []}

    async def routes(contexte):
        async def servir(route):
            chemin = route.request.url.split("outlook.office.com", 1)[1].split("?")[0]
            if chemin == "/__envoyes":
                envoyes["liste"] = json.loads(route.request.post_data or "[]")
                return await route.fulfill(status=204)
            if chemin.endswith("/book.js"):
                return await route.fulfill(status=200, content_type="text/javascript; charset=utf-8", body=BOOK)
            if chemin.startswith("/releve/"):
                return await route.fulfill(status=200, content_type="text/html; charset=utf-8", body=PAGE_RELEVE)
            return await route.fulfill(status=200, content_type="text/html; charset=utf-8", body=PAGE_ENVOI)
        await contexte.route("https://outlook.office.com/**", servir)
    monkeypatch.setattr(travaux, "installer_routes", routes)

    u, _ = base.compte_outlook("lea@essca.fr")
    etat = {"cookies": [{"name": "ESTSAUTH", "value": "x", "domain": "outlook.office.com", "path": "/", "expires": -1,
                         "httpOnly": True, "secure": True, "sameSite": "Lax"}], "origins": []}
    base.outlook_ecrire(u["id"], "lea@essca.fr", coffre.fermer(json.dumps(etat)))
    base.parametres_ecrire(u["id"], {"pack": 20, "attente": 30, "destinataires": 1, "taille_pack": 1, "packs_heure": 120, "max_jour": 400, "heure_debut": 0, "heure_fin": 24, "preset": "perso"})
    jeton = base.ouvrir_session(u["id"], "test")

    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=srv.run, daemon=True).start()
    while not srv.started:
        time.sleep(0.05)
    yield {"url": f"http://127.0.0.1:{port}", "jeton": jeton, "envoyes": envoyes}
    srv.should_exit = True
    time.sleep(1)


def test_parcours_etudiant_complet(serveur):
    from playwright.sync_api import sync_playwright, expect
    with sync_playwright() as p:
        iphone = dict(p.devices["iPhone 15"]); iphone.pop("default_browser_type", None)
        nav = p.chromium.launch()
        ctx = nav.new_context(**iphone)
        ctx.add_init_script(f"localStorage.setItem('smartmail', JSON.stringify({{code: '{serveur['jeton']}'}}))")
        page = ctx.new_page()
        erreurs = []
        page.on("pageerror", lambda e: erreurs.append(str(e)))
        page.on("dialog", lambda d: d.accept())
        # Le parcours complet (recherche, message, envoi) se fait depuis la console ; l'ambassadeur, lui,
        # ne voit que la date de son envoi (test_ambassadeur_date_seulement).
        page.goto(serveur["url"] + "/?console=1#jeton=" + serveur["jeton"])

        # 1. Lancer la recherche
        expect(page.locator("#e-objectif")).to_be_visible(timeout=20000)
        page.fill("#objectif", "1000")
        page.click("#start")
        expect(page.locator("#e-recolte")).to_be_visible()
        expect(page.locator("#pause")).to_have_text("Mettre en pause", timeout=20000)
        expect(page.locator("#liste li:not(.vide)").first).to_be_visible(timeout=120000)  # les adresses arrivent

        # 2. Mettre en pause, puis reprendre
        page.click("#pause")
        expect(page.locator("#pause")).to_have_text("Reprendre la recherche", timeout=90000)
        avant = page.locator("#liste li:not(.vide)").count()
        assert avant >= 1
        page.click("#pause")
        expect(page.locator("#pause")).to_have_text("Mettre en pause", timeout=30000)
        # La recherche EXTRAIT tout l'annuaire, sans IA : les contacts s'affichent, aucun n'est encore trié.
        expect(page.locator("#statut-texte")).to_contain_text("Annuaire extrait : 38 contacts", timeout=240000)
        expect(page.locator("#extraits")).to_have_text("38")
        assert page.locator("#liste li:not(.vide)").count() == 38 and page.text_content("#trouves") == "0"

        # 2 bis. « Garder seulement les étudiants » : la logique est apprise sur tout l'annuaire
        expect(page.locator("#carte-tri")).to_be_visible()
        expect(page.locator("#lancer-tri")).to_have_text("Garder seulement les étudiants")
        page.click("#lancer-tri")
        expect(page.locator("#tri-etat")).to_contain_text("Terminé", timeout=120000)
        expect(page.locator("#tri-logique")).to_contain_text("Logique de votre école")
        expect(page.locator("#lancer-tri")).to_have_text("Tout est trié", timeout=10000)
        page.wait_for_function("() => Number(document.getElementById('trouves').textContent.replace(/\\D/g, '')) > 0", timeout=20000)
        expect(page.locator("#liste li.vide")).to_have_count(0, timeout=10000)
        exclus = int(page.text_content("#ecartes").replace(" ", "").replace(" ", ""))
        assert exclus >= 1

        # 3. Seuls les étudiants restent dans la collecte ; les autres sont dans « Exclus »
        total = int(page.text_content("#trouves").replace(" ", "").replace(" ", ""))
        assert total >= 1 and page.locator("#liste li:not(.vide)").count() == total and total + exclus == 38, (total, exclus)
        assert page.locator("#liste li .a").all_text_contents() and all(
            a.endswith(("@essca.fr", "@essca.eu", "@essec.edu")) for a in page.locator("#liste li .a").all_text_contents())

        # 4. Message (onglet « Message » du haut) : le modèle a la date limite et le lien ; on s'envoie un test
        page.click('.etapes-nav li[data-n="2"]')
        expect(page.locator("#e-envoi")).to_be_visible()
        assert "enroll before {date}" in page.input_value("#message")
        assert "[GET YOUR AI CERTIFICATION](https://the-ai-certification.com/school)" in page.input_value("#message")
        expect(page.locator("#apercu-date")).to_contain_text("aujourd'hui + 6 jours")
        expect(page.locator("#apercu-date")).to_contain_text("lien cliquable")
        config.OUTLOOK_URL = "https://outlook.office.com/mail/"
        # L'envoi par packs est dans l'écran Envoi (« Suivant : l'envoi ») : on règle les mails par pack et l'attente.
        page.click("#vers-preparation")
        expect(page.locator("#e-envoye")).to_be_visible()
        expect(page.locator("#rythme")).to_be_visible()
        assert page.input_value("#pk-pack") == "20" and page.input_value("#pk-attente") == "30"
        page.click('#rythme .pas-btn[data-cible="pk-attente"][data-d="5"]')
        assert page.input_value("#pk-attente") == "35"
        page.fill("#pk-pack", "200"); page.locator("#pk-pack").dispatch_event("change")
        expect(page.locator("#pk-resume")).to_contain_text("200 mails, puis 35 min de pause")
        expect(page.locator("#pk-frise .pk-bloc")).to_have_count(3)
        fin_p = time.time() + 10
        while time.time() < fin_p and base.parametres_lire(base.utilisateur_par_email("lea@essca.fr")["id"]).get("pack") != 200:
            time.sleep(0.3)
        p_ = base.parametres_lire(base.utilisateur_par_email("lea@essca.fr")["id"])
        assert p_["pack"] == 200 and p_["attente"] == 35  # enregistré dans le compte
        page.click("#retour-message")
        expect(page.locator("#e-envoi")).to_be_visible()
        page.click("#tester-envoi")
        expect(page.locator("#test-etat")).to_contain_text("Message test envoyé à lea@essca.fr", timeout=120000)
        m = serveur["envoyes"]["liste"][0]
        assert m["a"] == ["lea@essca.fr"] and m["importance"] and m["objet"].startswith("[Test] ")
        assert "{date}" not in m["corps"] and "enroll before " in m["corps"]
        assert ">GET YOUR AI CERTIFICATION</a>" in m["html"] and 'href="https://the-ai-certification.com/school"' in m["html"]

        # 5. Onglet « Destinataires » : la collecte, intacte. (« Tester l'envoi » dans la barre du haut
        #    a été retiré de la console le 12/11 : le test se fait depuis l'écran Message, ci-dessus.)
        page.click('.etapes-nav li[data-n="1"]')
        expect(page.locator("#e-recolte")).to_be_visible()
        expect(page.locator("#liste li:not(.vide)")).to_have_count(total, timeout=20000)
        assert page.locator("#ouvrir-test").is_hidden()

        # 6. Message en français (choix de la langue), puis lancer l'envoi : les élèves
        #    se cochent un à un dans la liste de l'écran Envoi ; on circule librement.
        page.click('.etapes-nav li[data-n="2"]')
        page.select_option("#langue", "fr")
        assert "inscrivez-vous avant le {date}" in page.input_value("#message")
        assert page.input_value("#objet") == "The AI Certification : inscrivez-vous avant le {date}"
        expect(page.locator("#apercu-date")).to_contain_text(travaux.date_limite(langue="fr"))
        serveur["envoyes"]["liste"] = []
        page.click("#vers-preparation")
        page.click("#lancer-envoi")
        expect(page.locator("#e-envoye")).to_be_visible(timeout=20000)
        # Deux parties : « À envoyer » (la collecte) et « Reçu » ; les élèves passent de l'une à l'autre.
        expect(page.locator("#liste-a-envoyer li:not(.vide)")).to_have_count(total, timeout=20000)
        page.click('#parties [data-partie="recus"]')
        expect(page.locator("#liste-recus li.envoye").first).to_be_visible(timeout=120000)  # le premier reçu arrive
        page.click('#parties [data-partie="a-envoyer"]')
        page.click('.etapes-nav li[data-n="1"]')
        expect(page.locator("#e-recolte")).to_be_visible()
        page.click('.etapes-nav li[data-n="3"]')
        expect(page.locator("#e-envoye")).to_be_visible()
        expect(page.locator("#titre-envoi")).to_have_text("Envoi terminé", timeout=240000)
        assert page.text_content("#envoyes").replace("\u202f", "") == str(total)
        assert page.text_content("#restants") == "0"
        expect(page.locator("#liste-recus li.envoye")).to_have_count(total, timeout=15000)  # tout le monde a reçu
        expect(page.locator("#liste-a-envoyer li:not(.vide)")).to_have_count(0)
        assert page.text_content("#nb-recus").replace("\u202f", "") == str(total) and page.text_content("#nb-a-envoyer") == "0"
        assert set(page.locator("#liste-recus li .etat").all_text_contents()) == {"Reçu"}
        # La collecte ne montre plus que ceux à qui on n'a pas encore envoyé : personne.
        page.click("#collecter-plus")
        expect(page.locator("#e-recolte")).to_be_visible()
        expect(page.locator("#liste li:not(.vide)")).to_have_count(0, timeout=10000)
        expect(page.locator("#bandeau-envoi")).to_contain_text("ont reçu le message")
        assert len(serveur["envoyes"]["liste"]) == total and all(m["importance"] for m in serveur["envoyes"]["liste"])
        m = serveur["envoyes"]["liste"][0]
        assert "inscrivez-vous avant le " + travaux.date_limite(langue="fr") + "." in m["corps"] and "{date}" not in m["corps"]
        assert ">OBTENEZ VOTRE CERTIFICATION IA</a>" in m["html"]
        assert erreurs == []
        nav.close()


def test_ambassadeur_date_seulement(serveur):
    """L'ambassadeur connecté ne voit qu'une chose : la date de son envoi, puis « Envoi programmé »."""
    from playwright.sync_api import sync_playwright, expect
    dossier = os.environ.get("SMARTMAIL_CAPTURES")
    with sync_playwright() as p:
        iphone = dict(p.devices["iPhone 15"]); iphone.pop("default_browser_type", None)
        nav = p.chromium.launch()
        ctx = nav.new_context(**iphone, locale="fr-FR", timezone_id="Europe/Paris")
        ctx.add_init_script(f"localStorage.setItem('smartmail', JSON.stringify({{code: '{serveur['jeton']}'}}))")
        page = ctx.new_page()
        erreurs = []
        page.on("pageerror", lambda e: erreurs.append(str(e)))
        if dossier:  # l'écran de connexion, tel qu'un ambassadeur le voit en arrivant
            vierge = nav.new_context(**iphone, locale="fr-FR").new_page()
            vierge.goto(serveur["url"]); vierge.wait_for_selector("#e-connexion", state="visible", timeout=20000)
            vierge.screenshot(path=os.path.join(dossier, "1-connexion.png"))
        page.goto(serveur["url"])
        expect(page.locator("#e-simple")).to_be_visible(timeout=20000)
        expect(page.locator("#s-choix")).to_be_visible()
        assert page.locator(".etapes-nav").is_hidden() and page.locator("#ouvrir-test").is_hidden()
        import datetime, zoneinfo
        jour = (datetime.datetime.now(zoneinfo.ZoneInfo("Europe/Paris")) + datetime.timedelta(days=10)).replace(hour=10, minute=0, second=0, microsecond=0)
        page.fill("#s-date", jour.strftime("%Y-%m-%dT%H:%M"))
        if dossier: page.screenshot(path=os.path.join(dossier, "2-date.png"))
        page.click("#s-programmer")  # case des conditions pas cochée : rien n'est programmé
        expect(page.locator("#s-erreur")).to_contain_text("conditions d'utilisation")
        assert "pilote" not in (base.parametres_lire(base.utilisateur_par_email("lea@essca.fr")["id"]) or {})
        assert page.locator(".s-cgu a").get_attribute("href") == "conditions.html"
        page.check("#s-cgu")
        if dossier: page.screenshot(path=os.path.join(dossier, "2b-date-coche.png"))
        page.click("#s-programmer")
        expect(page.locator("#s-ok")).to_be_visible(timeout=10000)
        acc = base.acceptation_derniere(base.utilisateur_par_email("lea@essca.fr")["id"])
        assert acc and acc["version"] == "2026-11-13"
        expect(page.locator("#s-quand")).to_contain_text(f"Envoi programmé : ")
        expect(page.locator("#s-quand")).to_contain_text("à 10 h 00")
        if dossier: page.wait_for_timeout(1200); page.screenshot(path=os.path.join(dossier, "3-programme.png"))
        uid = base.utilisateur_par_email("lea@essca.fr")["id"]
        pl = base.parametres_lire(uid)["pilote"]
        assert abs(pl["debut"] - jour.timestamp()) < 1 and pl["etape"] == "collecte"
        page.reload()
        expect(page.locator("#s-ok")).to_be_visible(timeout=20000)  # la date est gardée
        assert not erreurs, erreurs
        nav.close()
