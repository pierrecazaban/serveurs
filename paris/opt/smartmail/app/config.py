"""Réglages du serveur, lus dans l'environnement (fichier .env en production).

La clé Anthropic n'apparaît nulle part dans le code : le SDK la lit dans
ANTHROPIC_API_KEY. Elle ne quitte jamais le serveur.
"""

import os
from pathlib import Path


def _env(nom, defaut):
    v = os.environ.get(nom)
    return v if v not in (None, "") else defaut


MODELE = _env("SMARTMAIL_MODELE", "claude-opus-5-5")
# Le tri est une tâche de classement : un effort bas suffit (moins de jetons de réflexion).
EFFORT = _env("SMARTMAIL_EFFORT", "low")
# Le tri en masse (élève ou non, par lots) : Claude Haiku 5.5, 40 fois moins cher
# qu'Opus et mêmes réponses sur un échantillon réel (150/150). Opus (MODELE) reste
# pour apprendre la logique de l'école, une fois par recherche.
MODELE_TRI = _env("SMARTMAIL_MODELE_TRI", "claude-haiku-5-5")
# Modèles qui acceptent le repli automatique côté serveur en cas de refus.
AVEC_REPLI = ("claude-opus", "claude-fable", "claude-sonnet-5-5")
TAILLE_LOT = int(_env("SMARTMAIL_TAILLE_LOT", "150"))
PARALLELE = int(_env("SMARTMAIL_PARALLELE", "4"))  # lots en parallèle pour UNE demande
APPELS_MAX = int(_env("SMARTMAIL_APPELS_MAX", "8"))  # appels simultanés à Claude pour TOUT le serveur
# Plafond de dépense mensuel, tous utilisateurs confondus (en dollars). Fixez aussi
# une limite dans la console Anthropic : c'est la vraie ceinture de sécurité.
BUDGET_MENSUEL_USD = float(_env("SMARTMAIL_BUDGET_MENSUEL_USD", "50"))
MAX_CONTACTS_PAR_REQUETE = int(_env("SMARTMAIL_MAX_CONTACTS_PAR_REQUETE", "2000"))
CACHE_JOURS = int(_env("SMARTMAIL_CACHE_JOURS", "180"))

# ------------------------------------------------------------------ comptes
# On se connecte avec son compte Outlook, rien d'autre : pas de mot de passe à
# retenir, pas de mot de passe à voler. Le serveur ne garde qu'une session par
# appareil, rattachée à un seul compte.
# Une fois connecté, on le reste : la session ne se ferme que si la personne se
# déconnecte, ferme cet appareil depuis un autre, ou si un administrateur coupe
# son accès. Mettre un nombre de jours pour faire expirer les sessions inutilisées.
SESSION_JOURS = int(_env("SMARTMAIL_SESSION_JOURS", "0"))
# Cookie de secours (HttpOnly) : si le téléphone vide le stockage de l'app, la
# session revient toute seule au prochain lancement. 400 jours : le maximum des navigateurs.
COOKIE_SESSION = "sm_session"
COOKIE_JOURS = 400
QUOTA_PAR_DEFAUT = int(_env("SMARTMAIL_QUOTA_PAR_DEFAUT", "200000"))  # contacts triés par l'IA par mois (Haiku : quelques $)
ROLES = ("ambassadeur", "administrateur")
# Adresses qui deviennent administratrices à leur première connexion (le premier
# accès d'un VPS neuf). Ensuite, un administrateur promeut les autres depuis l'app.
ADMINS = [a.strip().lower() for a in _env("SMARTMAIL_ADMINS", "").split(",") if a.strip()]
# Domaines autorisés à se connecter (vide = tous). Ex. « ecole.fr,etu.ecole.fr ».
DOMAINES = [d.strip().lower().lstrip("@") for d in _env("SMARTMAIL_DOMAINES", "").split(",") if d.strip()]

# ------------------------------------------------- connexion Outlook (navigateur)
# Le serveur se connecte à Outlook web comme le ferait la personne, dans un vrai
# navigateur (Playwright, Chromium sans fenêtre). La session du navigateur reste
# sur le serveur ; le mot de passe ne sert qu'à la connexion et n'est jamais gardé.
OUTLOOK_URL = _env("SMARTMAIL_OUTLOOK_URL", "https://outlook.office.com/mail/")
# Adresses où l'on considère être arrivé dans la messagerie (connexion réussie).
OUTLOOK_ARRIVEE = [u.strip() for u in _env(
    "SMARTMAIL_OUTLOOK_ARRIVEE", "https://outlook.office.com/mail,https://outlook.office365.com/mail,https://outlook.live.com/mail,"
    "https://outlook.cloud.microsoft/mail").split(",") if u.strip()]
# Cookies que Microsoft ne pose qu'APRÈS une authentification réussie (comptes
# d'établissement : ESTSAUTH… ; comptes personnels : MSPAuth…). Être sur la page de
# la messagerie ne suffit pas : Outlook web s'affiche un instant avant de renvoyer
# vers la connexion.
# Boîte de réception d'Outlook web (avis « non distribué » pendant un envoi).
OUTLOOK_BOITE = _env("SMARTMAIL_OUTLOOK_BOITE", "https://outlook.office.com/mail/inbox")
PAS_BOITE = float(_env("SMARTMAIL_PAS_BOITE", "45"))  # secondes entre deux lectures de la boîte
# Gmail (comptes Google de l'établissement) : la même connexion en direct, sur la vraie page Google.
GMAIL_URL = _env("SMARTMAIL_GMAIL_URL", "https://mail.google.com/mail/u/0/")
GMAIL_ARRIVEE = [u.strip() for u in _env("SMARTMAIL_GMAIL_ARRIVEE", "https://mail.google.com/mail/").split(",") if u.strip()]
# Cookies que Google ne pose qu'après une connexion réussie.
COOKIES_GOOGLE = [c.strip() for c in _env("SMARTMAIL_COOKIES_GOOGLE", "SID,__Secure-1PSID,__Secure-3PSID").split(",") if c.strip()]
COOKIES_AUTH = [c.strip() for c in _env("SMARTMAIL_COOKIES_AUTH", "ESTSAUTH,ESTSAUTHPERSISTENT,MSPAuth,__Host-MSAAUTH").split(",") if c.strip()]
CONNEXIONS_SIMULTANEES = int(_env("SMARTMAIL_CONNEXIONS_SIMULTANEES", "3"))  # navigateurs ouverts en même temps
CONNEXION_DELAI = int(_env("SMARTMAIL_CONNEXION_DELAI", "180"))  # secondes pour finir une connexion (validation comprise)
NAVIGATEUR_VISIBLE = _env("SMARTMAIL_NAVIGATEUR_VISIBLE", "0") == "1"  # pour regarder le navigateur en local
ESSAIS_PAR_ADRESSE = int(_env("SMARTMAIL_ESSAIS_PAR_ADRESSE", "5"))  # tentatives par quart d'heure
ESSAIS_PAR_IP = int(_env("SMARTMAIL_ESSAIS_PAR_IP", "20"))

# Clé de chiffrement des sessions Outlook rangées en base. Vide : un fichier de clé
# est créé à côté de la base, lisible du seul compte du serveur.
CLE_COFFRE = _env("SMARTMAIL_CLE_COFFRE", "")
BASE = Path(_env("SMARTMAIL_BASE", str(Path(__file__).resolve().parent.parent / "data" / "smartmail.db")))
CLE_FICHIER = Path(_env("SMARTMAIL_CLE_FICHIER", str(BASE.parent / "cle_coffre")))
# Mode démonstration / tests : un faux classeur déterministe remplace Claude.
FAUX_CLAUDE = _env("SMARTMAIL_FAUX_CLAUDE", "0") == "1"
DEMO = _env("SMARTMAIL_DEMO", "0") == "1"  # faux annuaire + accès de démonstration (/demo/...)
FAUX_LATENCE = float(_env("SMARTMAIL_FAUX_LATENCE", "0"))  # secondes par lot, en simulation
ORIGINES = [o.strip() for o in _env(
    "SMARTMAIL_ORIGINES",
    "https://outlook.office.com,https://outlook.office365.com,https://outlook.live.com,https://outlook.cloud.microsoft",
).split(",") if o.strip()]

# Prix par million de jetons (entrée, sortie), en dollars : sert au suivi des
# dépenses et au plafond. À tenir à jour si vous changez de modèle.
PRIX = {
    "claude-opus-5-5": (4.00, 20.00),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-opus-4-8": (5.00, 25.00),
}


def cout(modele, jetons_entree, jetons_sortie):
    pe, ps = PRIX.get(modele, PRIX["claude-opus-5-5"])
    return (jetons_entree * pe + jetons_sortie * ps) / 1_000_000

# Entretien : chaque session Outlook est rouverte au moins une fois par jour pour
# rester vivante chez Microsoft. 0 = désactivé (tests).
ENTRETIEN_HEURES = float(_env("SMARTMAIL_ENTRETIEN_HEURES", "6"))

# ------------------------------------------------- travail du serveur (annuaire, envoi)
# Le serveur fait tourner l'extension Smart Mail dans son Chromium, avec la session
# Outlook de la personne : c'est elle qui relève l'annuaire et qui envoie.
EXTENSION_DIR = Path(_env("SMARTMAIL_EXTENSION", str(Path(__file__).resolve().parent.parent.parent / "extension")))
NAVIGATEURS_MAX = int(_env("SMARTMAIL_NAVIGATEURS_MAX", "4"))  # navigateurs en même temps (≈ 1,3 Go et 1 cœur chacun)
FUSEAU = _env("SMARTMAIL_FUSEAU", "Europe/Paris")  # plage horaire d'envoi
PAS_SUIVI = float(_env("SMARTMAIL_PAS_SUIVI", "3"))  # secondes entre deux relevés de l'état
PAS_SAUVEGARDE = float(_env("SMARTMAIL_PAS_SAUVEGARDE", "60"))  # mémoire de l'extension rangée au moins toutes les N s
# Code d'accès du jour (vide = pas de code, comme en test). Le même secret est sur Vercel (TOOL_GATE_SECRET).
PORTE_SECRET = _env("SMARTMAIL_PORTE_SECRET", "")
VERIFIER_LIENS = _env("SMARTMAIL_VERIFIER_LIENS", "1") == "1"  # avant un envoi : les liens du message répondent ?
REPRENDRE_TRAVAUX = _env("SMARTMAIL_REPRENDRE_TRAVAUX", "1") == "1"  # au démarrage du serveur
