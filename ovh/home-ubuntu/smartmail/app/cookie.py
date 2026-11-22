"""Cookie de secours de la session d'appareil.

L'application garde son jeton de session dans son stockage local. Sur iPhone,
le système peut vider ce stockage (place manquante, réglages) : le même jeton est
donc aussi posé dans un cookie HttpOnly, invisible du JavaScript, envoyé à une
seule adresse (/v1/session/reprendre) et jamais depuis un autre site
(SameSite=Strict). Au lancement suivant, l'app récupère sa session sans rien
redemander."""

from . import config

CHEMIN = "/v1/session"


def _chemin(request):
    """Sous the-ai-certification.com/tool, le cookie vit sous /tool/v1/session."""
    return ("/tool" if request.headers.get("x-base") == "/tool" else "") + CHEMIN


def _https(request):
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").startswith("https")


def poser(response, request, jeton):
    response.set_cookie(config.COOKIE_SESSION, jeton, max_age=config.COOKIE_JOURS * 86400, httponly=True,
                        secure=_https(request), samesite="strict", path=_chemin(request))


def effacer(response, request):
    response.delete_cookie(config.COOKIE_SESSION, path=_chemin(request), httponly=True, secure=_https(request), samesite="strict")


def lire(request):
    return request.cookies.get(config.COOKIE_SESSION, "")
