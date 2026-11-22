"""Bout en bout de l'interface, format iPhone : un vrai navigateur ouvre l'app,
touche « Se connecter avec Outlook », tape dans la page Microsoft affichée en
direct (ici un faux Microsoft fidèle), et arrive connecté dans Smart Mail."""

import socket
import threading
import time

import pytest
import uvicorn

from app import base, config, direct
from app.main import app
from faux_microsoft import FauxMicrosoft


@pytest.fixture
def serveur(monkeypatch):
    faux = FauxMicrosoft().demarrer()
    faux.ajouter("lea@ecole.fr", "Secret-1")
    monkeypatch.setattr(config, "OUTLOOK_URL", faux.url + "/mail/")
    monkeypatch.setattr(config, "OUTLOOK_ARRIVEE", [faux.url + "/mail"])
    monkeypatch.setattr(config, "DEMO", False)
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=srv.run, daemon=True).start()
    fin = time.time() + 15
    while not srv.started and time.time() < fin:
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    time.sleep(0.5)
    faux.arreter()


def test_iphone_se_connecter_avec_outlook(serveur):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        iphone = dict(p.devices["iPhone 15"]); iphone.pop("default_browser_type", None)
        nav = p.chromium.launch()
        page = nav.new_context(**iphone).new_page()
        erreurs = []
        page.on("pageerror", lambda e: erreurs.append(str(e)))
        page.goto(serveur)
        page.wait_for_selector("#connexion-outlook:visible")
        page.click("#connexion-outlook")
        page.wait_for_selector("#direct:not([hidden])")
        page.wait_for_function("document.getElementById('direct-ecran').naturalWidth > 0", timeout=20000)

        def ecran():
            return next(iter(direct._ecrans.values()))

        # La position des champs dans la page Microsoft, lue côté serveur.
        import asyncio

        def position(selecteur):
            e = ecran()
            fut = asyncio.run_coroutine_threadsafe(e.page.locator(selecteur).first.bounding_box(), e.boucle)
            b = fut.result(10)
            return (b["x"] + b["width"] / 2, b["y"] + b["height"] / 2) if b else None

        def attendre_champ(selecteur, delai=20):
            fin = time.time() + delai
            while time.time() < fin:
                try:
                    pos = position(selecteur)
                    if pos:
                        return pos
                except Exception:
                    pass
                time.sleep(0.3)
            raise AssertionError(f"champ jamais affiché : {selecteur}")

        def taper_dans(selecteur, texte, clavier):
            x, y = attendre_champ(selecteur)
            zone = page.eval_on_selector("#direct-zone", "z => { const r = z.getBoundingClientRect(); return [r.left, r.top]; }")
            page.mouse.click(zone[0] + x, zone[1] + y)
            # Comme une vraie personne : on touche, le bon clavier s'ouvre, puis on tape.
            page.wait_for_function("t => document.activeElement && document.activeElement.id === 'direct-saisie' "
                                   "&& document.activeElement.type === t", arg=clavier, timeout=10000)
            page.keyboard.type(texte, delay=20)
            page.keyboard.press("Enter")

        taper_dans("input[name=loginfmt]", "lea@ecole.fr", "email")        # clavier d'adresse
        taper_dans("input[name=passwd]:not(.moveOffScreen)", "Secret-1", "password")  # clavier de mot de passe
        x, y = attendre_champ("#idSIButton9[value=Oui]")
        zone = page.eval_on_selector("#direct-zone", "z => { const r = z.getBoundingClientRect(); return [r.left, r.top]; }")
        page.mouse.click(zone[0] + x, zone[1] + y)
        page.wait_for_selector("#e-simple:not([hidden])", timeout=40000)  # connecté : l'écran de la date d'envoi
        assert page.is_hidden("#direct")
        assert base.utilisateur_par_email("lea@ecole.fr") is not None
        # Relancée plus tard (stockage de l'app vidé) : toujours connectée.
        page.evaluate("localStorage.clear()")
        page.reload()
        page.wait_for_selector("#e-simple:not([hidden])", timeout=20000)
        assert erreurs == []
        nav.close()
