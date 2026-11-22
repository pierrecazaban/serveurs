"""Coffre des secrets rangés en base : les jetons Outlook.

Pourquoi chiffrer : le jeton de rafraîchissement est la session Outlook de la
personne. Il vit sur le serveur pour que les envois continuent quand l'ordinateur
est éteint, mais une copie du fichier de base (sauvegarde, disque récupéré) ne
doit pas suffire à lire ou envoyer son courrier. La clé n'est donc jamais dans la
base : elle vient de SMARTMAIL_CLE_COFFRE (fichier .env), ou d'un fichier voisin
créé au premier démarrage et lisible du seul compte du serveur.

Construction : deux clés dérivées de la clé maîtresse (HKDF-SHA256), un flot de
chiffrement, puis une signature HMAC-SHA256 sur le tout (chiffrer puis signer). Un
jeton modifié ou venant d'une autre clé est refusé au lieu d'être déchiffré de travers.
Format v2 (actuel) : flot SHAKE-256(clé ‖ sel aléatoire), produit d'un seul coup — la
mémoire d'une recherche (plusieurs Mo) se chiffre en quelques millisecondes. Format v1
(ancien, flot HMAC-SHA256 en mode compteur) : toujours lu.
"""

import base64
import hashlib
import hmac
import os
import secrets
import threading

from . import config

_verrou = threading.Lock()
_cles = None
VERSION = b"v2"
ANCIENNE = b"v1"


def _hkdf(maitresse, info, n=32):
    prk = hmac.new(b"smartmail-coffre", maitresse, hashlib.sha256).digest()
    sortie, bloc, i = b"", b"", 1
    while len(sortie) < n:
        bloc = hmac.new(prk, bloc + info + bytes([i]), hashlib.sha256).digest()
        sortie += bloc
        i += 1
    return sortie[:n]


def _fichier_cle():
    chemin = config.CLE_FICHIER
    chemin.parent.mkdir(parents=True, exist_ok=True)
    if not chemin.exists():
        # Création atomique, lisible du seul compte du serveur.
        tmp = chemin.with_suffix(".tmp")
        d = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            os.write(d, secrets.token_hex(32).encode())
        finally:
            os.close(d)
        os.replace(tmp, chemin)
    os.chmod(chemin, 0o600)
    return chemin.read_bytes().strip()


def cles():
    """(clé de chiffrement, clé de signature), dérivées une fois pour toutes."""
    global _cles
    with _verrou:
        if _cles is None:
            maitresse = (config.CLE_COFFRE or "").strip().encode() or _fichier_cle()
            _cles = (_hkdf(maitresse, b"chiffrement"), _hkdf(maitresse, b"signature"))
        return _cles


def oublier_cles():
    """Pour les tests : force une nouvelle lecture de la clé."""
    global _cles
    with _verrou:
        _cles = None


def _flot_v1(cle, sel, n):
    blocs = [hmac.new(cle, sel + i.to_bytes(4, "big"), hashlib.sha256).digest() for i in range((n + 31) // 32)]
    return b"".join(blocs)[:n]


def _flot(cle, sel, n):
    return hashlib.shake_256(b"smartmail-coffre-v2" + cle + sel).digest(n) if n else b""


def _xor(a, b):
    if not a:
        return b""
    return (int.from_bytes(a, "big") ^ int.from_bytes(b, "big")).to_bytes(len(a), "big")


def fermer(secret):
    """Chiffre un secret (texte) pour la base. Rend une chaîne sûre à stocker."""
    if secret is None:
        return ""
    k_chiffre, k_signe = cles()
    clair = str(secret).encode()
    sel = secrets.token_bytes(16)
    chiffre = _xor(clair, _flot(k_chiffre, sel, len(clair)))
    corps = VERSION + sel + chiffre
    signature = hmac.new(k_signe, corps, hashlib.sha256).digest()[:16]
    return base64.urlsafe_b64encode(corps + signature).decode()


def ouvrir(range_):
    """Déchiffre un secret rangé en base. Rend "" si vide, illisible ou falsifié."""
    if not range_:
        return ""
    k_chiffre, k_signe = cles()
    try:
        brut = base64.urlsafe_b64decode(range_.encode())
    except Exception:
        return ""
    if len(brut) < len(VERSION) + 16 + 16 or not (brut.startswith(VERSION) or brut.startswith(ANCIENNE)):
        return ""
    corps, signature = brut[:-16], brut[-16:]
    if not hmac.compare_digest(hmac.new(k_signe, corps, hashlib.sha256).digest()[:16], signature):
        return ""
    sel, chiffre = corps[len(VERSION):len(VERSION) + 16], corps[len(VERSION) + 16:]
    flot = _flot(k_chiffre, sel, len(chiffre)) if brut.startswith(VERSION) else _flot_v1(k_chiffre, sel, len(chiffre))
    return _xor(chiffre, flot).decode("utf-8", "replace")
