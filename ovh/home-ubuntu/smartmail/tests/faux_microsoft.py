"""Faux Outlook web + fausse page de connexion Microsoft, pour tester la connexion
par le serveur sans compte réel. Mêmes repères que la vraie page (loginfmt,
passwd, idSIButton9, idRichContext_DisplaySign, otc, « Rester connecté ? »)."""

import html
import secrets
import socket
import threading
import time

import uvicorn
from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse


def _page(corps):
    return HTMLResponse(f"<!doctype html><html lang='fr'><head><meta charset='utf-8'><title>Se connecter</title></head>"
                        f"<body>{corps}</body></html>")


class FauxMicrosoft:
    def __init__(self):
        # adresse -> {mdp, mfa: None | "nombre" | "code", code}
        self.comptes = {}
        self.sessions = {}  # cookie -> adresse
        self.approuvees = set()
        self.refusees = set()
        self.essais_mdp = []  # (adresse, mdp) reçus
        self.sans_identite = False  # la messagerie ne donne pas sa configuration
        self.sans_login = False     # le formulaire du mot de passe n'envoie pas l'adresse
        # Faux Google : comptes, sessions (cookie SID), et Gmail sans compte affiché.
        self.google = {}
        self.sessions_google = {}
        self.gmail_sans_compte = False
        self.app = self._app()
        self.port = None
        self._serveur = None

    def ajouter(self, adresse, mdp, mfa=None, code="123456", cle=False, cle_non_prise=False):
        self.comptes[adresse] = {"mdp": mdp, "mfa": mfa, "code": code, "cle": cle, "cle_non_prise": cle_non_prise}

    def approuver(self, adresse):
        self.approuvees.add(adresse)

    def refuser(self, adresse):
        self.refusees.add(adresse)

    def revoquer(self, adresse):
        for k in [k for k, v in self.sessions.items() if v == adresse]:
            del self.sessions[k]

    @property
    def url(self):
        return f"http://127.0.0.1:{self.port}"

    def _app(self):
        app = FastAPI()
        f = self

        def page_adresse(erreur=""):
            e = f"<div id='usernameError' role='alert'>{erreur}</div>" if erreur else ""
            return _page(f"<form method='post' action='/login/adresse'><div>Connexion</div>{e}"
                         "<input type='email' name='loginfmt' aria-label='Adresse e-mail'>"
                         # Comme la vraie page : un champ mot de passe piège, hors de l'écran.
                         "<input type='password' name='passwd' class='moveOffScreen' tabindex='-1' aria-hidden='true'"
                         " style='position:absolute;left:-10000px;top:0;width:200px;height:20px'>"
                         "<input type='submit' id='idSIButton9' value='Suivant'></form>")

        def page_mdp(adresse, erreur=""):
            e = f"<div id='passwordError' role='alert'>{erreur}</div>" if erreur else ""
            return _page(f"<form method='post' action='/login/mdp'><div>Entrer le mot de passe</div>{e}"
                         f"<input type='hidden' name='adresse' value='{html.escape(adresse)}'>"
                         + ("" if f.sans_login else f"<input type='hidden' name='login' value='{html.escape(adresse)}'>") +
                         "<input type='password' name='passwd' aria-label='Mot de passe'>"
                         "<input type='submit' id='idSIButton9' value='Se connecter'></form>")

        def page_kmsi(adresse):
            return _page(f"<form method='post' action='/login/kmsi'><div>Rester connecté ?</div>"
                         f"<input type='hidden' name='adresse' value='{html.escape(adresse)}'>"
                         "<label><input type='checkbox' name='DontShowAgain'> Ne plus afficher</label>"
                         "<input type='submit' id='idBtn_Back' value='Non'>"
                         "<input type='submit' id='idSIButton9' value='Oui'></form>")

        def apres_mdp(adresse):
            c = f.comptes[adresse]
            if c["mfa"] == "nombre":
                return _page(f"<div>Approuver la demande de connexion</div><div id='idRichContext_DisplaySign'>42</div>"
                             f"<script>setInterval(async () => {{ const r = await fetch('/login/attente?adresse={adresse}');"
                             f" const t = await r.text(); if (t === 'ok') location.href = '/login/kmsi?adresse={adresse}';"
                             f" if (t === 'refus') document.body.innerHTML = '<div>Approuver la demande</div><div>Demande refusée (denied)</div>'; }}, 300);</script>")
            if c["mfa"] == "code":
                return page_code(adresse)
            return page_kmsi(adresse)

        def page_code(adresse, erreur=""):
            e = f"<div id='idSpan_SAOTCC_Error_OTC'>{erreur}</div>" if erreur else ""
            return _page(f"<form method='post' action='/login/code'><div>Entrer le code</div>{e}"
                         f"<input type='hidden' name='adresse' value='{html.escape(adresse)}'>"
                         "<input type='tel' name='otc' aria-label='Code'>"
                         "<input type='submit' id='idSubmit_SAOTCC_Continue' value='Vérifier'></form>")

        @app.get("/mail/")
        def mail(request: Request):
            if request.cookies.get("ESTSAUTH") in f.sessions:
                # Comme Outlook : la messagerie charge sa configuration de démarrage.
                script = "" if f.sans_identite else (
                    "<script>fetch('/owa/startupdata.ashx?app=Mail', {method: 'POST'}).catch(() => {});</script>")
                return _page("<div>Boîte de réception</div>" + script)
            # Comme le vrai Outlook web : la page de la messagerie se charge, puis
            # renvoie vers la connexion par JavaScript.
            return _page("<div>Chargement…</div><script>setTimeout(() => location.href = '/login', 700)</script>")

        @app.post("/owa/startupdata.ashx")
        def startupdata(request: Request):
            a = f.sessions.get(request.cookies.get("ESTSAUTH"))
            if not a:
                return JSONResponse({"error": "non connecté"}, status_code=440)
            # Une adresse d'expéditeur piège, plus profond : elle ne doit jamais être prise pour le compte.
            return JSONResponse({"findFolders": {"Body": {"ResponseMessages": {"Items": [
                                     {"RootFolder": {"Items": [{"From": {"Mailbox": {"EmailAddress": "pirate@ailleurs.fr"}}}]}}]}}},
                                 "owaUserConfig": {"SessionSettings": {"UserDisplayName": a, "UserEmailAddress": a}}})

        @app.get("/login")
        def login():
            return page_adresse()

        @app.post("/login/adresse")
        def adresse(loginfmt: str = Form("")):
            a = loginfmt.strip().lower()
            if a.endswith("@federe.fr"):  # établissement à portail propre : Microsoft y renvoie
                return RedirectResponse(f"/idp/login?hint={a}", status_code=303)
            if a.endswith("@adfs.fr"):
                return RedirectResponse(f"/adfs/ls?hint={a}", status_code=303)
            if a not in f.comptes:
                return page_adresse("Ce nom d'utilisateur est peut-être incorrect.")
            if f.comptes[a].get("cle_non_prise"):  # comme l'IESEG : le navigateur n'a pas de clé d'accès
                return _page(f"<div>{html.escape(a)}</div><h1>Clé d’accès non inscrite</h1>"
                             "<p>Ce navigateur ou cet appareil ne prend pas en charge les clés d’accès.</p>"
                             f"<a id='annuler' href='/common/options?a={a}'>Annuler</a><button>Réessayer</button>")
            if f.comptes[a].get("cle"):  # compte « clé d'accès d'abord », comme chez Microsoft
                return RedirectResponse(f"/common/bridge/fido?a={a}", status_code=303)
            return page_mdp(a)

        @app.get("/common/bridge/fido")
        def fido(a: str = ""):
            return _page(f"<div>{html.escape(a)}</div><div>Visage, empreinte digitale, code PIN ou clé de sécurité</div>"
                         "<div>Votre appareil va ouvrir une fenêtre de sécurité.</div>"
                         "<button id='idBtn_Back' type='button'>Retour</button>"
                         "<a id='moreOptions' href='#' onclick=\"document.getElementById('options').hidden=false;return false\">Options de connexion</a>"
                         f"<div id='options' hidden><div class='tile' role='button' onclick=\"location.href='/login/mdp-page?a={a}'\">"
                         "Utiliser mon mot de passe</div></div>")

        @app.get("/common/options")
        def options(a: str = ""):
            return _page("<h1>Options de connexion</h1>"
                         f"<div class='tile' role='button' id='choix-mdp' onclick=\"location.href='/login/mdp-page?a={a}'\">Utiliser mon mot de passe</div>")

        @app.get("/login/mdp-page")
        def mdp_page(a: str = ""):
            return page_mdp(a)

        # Portail type Shibboleth : identifiant VIDE, mot de passe, bouton « _eventId_proceed ».
        def page_idp(erreur=""):
            e = f"<p class='form-error'>{erreur}</p>" if erreur else ""
            return _page(f"<form method='post' action='/idp/login'><h1>Portail de l'établissement</h1>{e}"
                         "<input id='username' name='j_username' type='text'>"
                         "<input name='j_password' type='password'>"
                         "<button type='submit' name='_eventId_proceed'>Connexion</button></form>")

        @app.get("/idp/login")
        def idp_page(hint: str = ""):
            return page_idp()

        @app.post("/idp/login")
        def idp(j_username: str = Form(""), j_password: str = Form("")):
            a = j_username.strip().lower()
            f.essais_mdp.append((a, j_password))
            if f.comptes.get(a, {}).get("mdp") != j_password:
                return page_idp("Identifiant ou mot de passe incorrect.")
            return page_kmsi(a)

        # ADFS : identifiant PRÉ-REMPLI, bouton qui est un <span id="submitButton">.
        @app.get("/adfs/ls")
        def adfs_page(hint: str = "", erreur: str = ""):
            e = f"<span id='errorText'>{erreur}</span>" if erreur else ""
            return _page(f"<form method='post' action='/adfs/ls' id='loginForm'>{e}"
                         f"<input id='userNameInput' name='UserName' type='email' value='{html.escape(hint)}'>"
                         "<input id='passwordInput' name='Password' type='password'>"
                         "<span id='submitButton' role='button' onclick='loginForm.submit()'>Connexion</span></form>")

        @app.post("/adfs/ls")
        def adfs(UserName: str = Form(""), Password: str = Form("")):
            a = UserName.strip().lower()
            f.essais_mdp.append((a, Password))
            if f.comptes.get(a, {}).get("mdp") != Password:
                return RedirectResponse(f"/adfs/ls?hint={a}&erreur=Mot%20de%20passe%20incorrect", status_code=303)
            return page_kmsi(a)

        @app.post("/login/mdp")
        def mdp(adresse: str = Form(""), passwd: str = Form("")):
            f.essais_mdp.append((adresse, passwd))
            if f.comptes.get(adresse, {}).get("mdp") != passwd:
                return page_mdp(adresse, "Votre compte ou mot de passe est incorrect.")
            return apres_mdp(adresse)

        @app.get("/login/attente")
        def attente(adresse: str):
            if adresse in f.refusees:
                return HTMLResponse("refus")
            return HTMLResponse("ok" if adresse in f.approuvees else "attente")

        @app.post("/login/code")
        def code(adresse: str = Form(""), otc: str = Form("")):
            if f.comptes[adresse]["code"] != otc:
                return page_code(adresse, "Ce code n'est pas correct.")
            return page_kmsi(adresse)

        @app.get("/login/kmsi")
        def kmsi_page(adresse: str):
            return page_kmsi(adresse) if adresse in f.approuvees else RedirectResponse("/login", status_code=302)

        @app.post("/login/kmsi")
        def kmsi(adresse: str = Form(""), DontShowAgain: str = Form("")):
            jeton = secrets.token_urlsafe(16)
            f.sessions[jeton] = adresse
            r = RedirectResponse("/mail/", status_code=302)
            r.set_cookie("ESTSAUTH", jeton, max_age=90 * 86400 if DontShowAgain else None, httponly=True)
            return r

        # ---------------------------------------------------------------- faux Google
        # Mêmes repères que la vraie page : identifierId, Passwd, « Suivant ». Gmail écrit
        # le compte dans le titre de l'onglet et sur le bouton « Compte Google ».
        def page_google(corps, titre="Connexion - Comptes Google"):
            return HTMLResponse(f"<!doctype html><html lang='fr'><head><meta charset='utf-8'><title>{titre}</title></head>"
                                f"<body>{corps}</body></html>")

        @app.get("/gmail/mail/u/0/")
        def gmail(request: Request):
            a = f.sessions_google.get(request.cookies.get("SID"))
            if not a:
                return page_google("<div>Chargement…</div><script>setTimeout(() => location.href = '/google/signin', 500)</script>", "Gmail")
            if f.gmail_sans_compte:
                return page_google("<div>Boîte de réception</div><div>De : pirate@ailleurs.fr</div>", "Gmail")
            return page_google(f"<a href='#' aria-label='Compte Google : Léa ({html.escape(a)})'>L</a>"
                               "<div>Boîte de réception</div><div>De : pirate@ailleurs.fr - Objet - pirate@ailleurs.fr</div>",
                               f"Boîte de réception (3) - {html.escape(a)} - Messagerie École")

        @app.get("/google/signin")
        def google_adresse(erreur: str = ""):
            e = f"<div role='alert'>{html.escape(erreur)}</div>" if erreur else ""
            return page_google(f"<form method='post' action='/google/identifier'><h1>Connexion</h1>{e}"
                               "<input type='email' id='identifierId' name='identifier' aria-label='Adresse e-mail ou téléphone'>"
                               "<button id='identifierNext'>Suivant</button></form>")

        @app.post("/google/identifier")
        def google_identifier(identifier: str = Form("")):
            a = identifier.strip().lower()
            if a not in f.google:
                return RedirectResponse("/google/signin?erreur=Impossible+de+trouver+votre+compte+Google", status_code=302)
            return page_google(f"<form method='post' action='/google/password'><h1>Bienvenue</h1><div>{html.escape(a)}</div>"
                               f"<input type='hidden' name='a' value='{html.escape(a)}'>"
                               "<input type='password' name='Passwd' aria-label='Saisissez votre mot de passe'>"
                               "<button id='passwordNext'>Suivant</button></form>")

        @app.post("/google/password")
        def google_password(a: str = Form(""), Passwd: str = Form("")):
            if f.google.get(a) != Passwd:
                return page_google(f"<form method='post' action='/google/password'><div role='alert'>Mot de passe incorrect.</div>"
                                   f"<input type='hidden' name='a' value='{html.escape(a)}'>"
                                   "<input type='password' name='Passwd'><button id='passwordNext'>Suivant</button></form>")
            jeton = secrets.token_urlsafe(16)
            f.sessions_google[jeton] = a
            r = RedirectResponse("/gmail/mail/u/0/", status_code=302)
            r.set_cookie("SID", jeton, max_age=180 * 86400, httponly=True)
            return r

        return app

    def demarrer(self):
        s = socket.socket(); s.bind(("127.0.0.1", 0)); self.port = s.getsockname()[1]; s.close()
        self._serveur = uvicorn.Server(uvicorn.Config(self.app, host="127.0.0.1", port=self.port, log_level="warning"))
        threading.Thread(target=self._serveur.run, daemon=True).start()
        fin = time.time() + 10
        while not self._serveur.started and time.time() < fin:
            time.sleep(0.05)
        return self

    def arreter(self):
        if self._serveur:
            self._serveur.should_exit = True
