"""Code d'accès du jour : sans lui, l'app (the-ai-certification.com/tool) n'affiche qu'une page de mot de passe.
Le code (6 chiffres) change à minuit, heure de Paris. Il est calculé à partir d'un secret partagé avec le site
the-ai-certification.com, qui l'affiche sur sa page /admin (même calcul : lib/toolGate.ts)."""
import collections
import json
import os
import re
import urllib.parse
import urllib.request
import datetime
import hashlib
import hmac
import time
import zoneinfo

from . import config

PARIS = zoneinfo.ZoneInfo("Europe/Paris")
COOKIE = "smartmail_porte"
_ECHECS = collections.deque()  # moments des codes faux (contre les essais en série)


def jour():
    return datetime.datetime.now(PARIS).date().isoformat()


def _mac(texte):
    return hmac.new(config.PORTE_SECRET.encode(), texte.encode(), hashlib.sha256).digest()


def code(j=None):
    return f"{int.from_bytes(_mac('code:' + (j or jour()))[:8], 'big') % 1_000_000:06d}"


def jeton(j=None):
    return _mac("porte:" + (j or jour())).hex()


def valide(valeur):
    return bool(valeur) and hmac.compare_digest(valeur, jeton())


# Administrateur : un cookie de 400 jours, lié à son compte, pour ne plus taper le code du jour.
COOKIE_ADMIN = "smartmail_porte_admin"


def jeton_admin(uid):
    return f"{int(uid)}.{_mac(f'admin:{int(uid)}').hex()}"


def admin_valide(valeur):
    """Le cookie administrateur ouvre la porte tant que son compte est administrateur et actif."""
    try:
        uid, _ = str(valeur or "").split(".", 1)
        uid = int(uid)
    except ValueError:
        return False
    if not hmac.compare_digest(valeur, jeton_admin(uid)):
        return False
    from . import base
    u = base.utilisateur_par_id(uid) or {}
    return u.get("role") == "administrateur" and bool(u.get("actif"))


def trop_d_essais():
    while _ECHECS and _ECHECS[0] < time.monotonic() - 600:
        _ECHECS.popleft()
    return len(_ECHECS) >= 30


def echec():
    _ECHECS.append(time.monotonic())


def verifier(propose):
    return hmac.compare_digest(str(propose or "").strip(), code())


# Code personnel d'un ambassadeur (18/11) : 6 caractères dont une lettre, vérifié auprès du site. Il ouvre le tool
# comme le code du jour, sans expirer, et rattache la personne à cet ambassadeur (cookie « parrain », puis son compte).
COOKIE_PARRAIN = "smartmail_parrain"
CODES_URL = os.environ.get("SMARTMAIL_CODES_URL", "https://the-ai-certification.com/api/smartmail/code")
_CODES = {}


def code_perso(propose):
    c = re.sub(r"\s+", "", str(propose or "")).upper()
    # Code personnel : 8 chiffres depuis le 19/11 (le code du jour en a 6) ; l ancien format à lettres reste lu.
    if not (re.fullmatch(r"[1-9]\d{7}", c) or (re.fullmatch(r"[A-Z0-9]{6}", c) and re.search(r"[A-Z]", c))):
        return None
    vu = _CODES.get(c)
    if vu and vu[0] > time.monotonic():
        return c if vu[1] else None
    from . import relances
    entetes = {"User-Agent": "smartmail"}
    if relances._cle():
        entetes["x-relances-key"] = relances._cle()
    try:
        rq = urllib.request.Request(CODES_URL + "?c=" + urllib.parse.quote(c), headers=entetes)
        ok = bool(json.load(urllib.request.urlopen(rq, timeout=8)).get("ok"))
    except Exception:
        return None  # site injoignable : seul le code du jour marche
    _CODES[c] = (time.monotonic() + (600 if ok else 60), ok)
    return c if ok else None


PAGE = """<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Smart Mail</title>
<style>
:root { color-scheme: light dark; --fond: #F7F7F8; --carte: #fff; --texte: #111; --doux: #666; --bord: #ddd; --accent: #4F46E5; }
@media (prefers-color-scheme: dark) { :root { --fond: #0B0B0D; --carte: #17171A; --texte: #F2F2F3; --doux: #9A9AA2; --bord: #2A2A30; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--fond); color: var(--texte);
  font: 16px/1.5 Inter, -apple-system, system-ui, sans-serif; }
main { width: 100%; max-width: 360px; background: var(--carte); border: 1px solid var(--bord); border-radius: 16px; padding: 28px 24px; }
h1 { margin: 0 0 4px; font-size: 22px; } p { margin: 0 0 20px; color: var(--doux); }
input { width: 100%; font: inherit; font-size: 26px; letter-spacing: .35em; text-align: center; padding: 12px; border-radius: 10px;
  border: 1px solid var(--bord); background: transparent; color: inherit; }
button { width: 100%; margin-top: 12px; font: inherit; font-weight: 600; padding: 12px; border: 0; border-radius: 10px; background: var(--accent); color: #fff; cursor: pointer; }
#e { min-height: 1.5em; margin: 12px 0 0; color: #DC2626; font-size: 14px; }
</style></head>
<body><main>
<h1>Smart Mail</h1><p>Entrez votre code d'accès : celui de votre ambassadeur, ou le code du jour.</p>
<form id="f"><input id="c" inputmode="numeric" autocapitalize="characters" autocorrect="off" spellcheck="false" autocomplete="off" maxlength="8" required autofocus aria-label="Code d'accès">
<button type="submit">Entrer</button></form><p id="e" role="alert"></p>
</main>
<script>
var B = location.pathname.indexOf("/tool") === 0 ? "/tool" : "";
document.getElementById("f").onsubmit = async function (ev) {
  ev.preventDefault();
  var e = document.getElementById("e"); e.textContent = "";
  try {
    var r = await fetch(B + "/porte", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: document.getElementById("c").value }) });
    if (r.ok) { location.reload(); return; }
    var j = {}; try { j = await r.json(); } catch (x) {}
    e.textContent = j.detail || "Code incorrect.";
  } catch (x) { e.textContent = "Connexion impossible. Réessayez."; }
};
</script></body></html>"""
