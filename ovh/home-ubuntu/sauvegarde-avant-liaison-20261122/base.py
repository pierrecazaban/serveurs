"""Base SQLite, sur le disque du serveur (volume /data du VPS) : comptes
(ambassadeurs et administrateurs, mot de passe haché, quota), sessions ouvertes
— une par appareil, rattachée à un seul compte —, consommation par mois, et
cache des tris (une adresse déjà triée ne coûte plus rien).

Rien n'est gardé côté navigateur sauf le jeton de session : toute la mémoire de
travail (destinataires, recherche, paramètres) est rangée ici sous l'identifiant
du compte, et n'est lisible qu'avec une session de ce compte."""

import contextvars
import hashlib
import json
import re
import secrets
import time
import sqlite3
import threading
from datetime import datetime, timedelta, timezone

from . import config

_verrou = threading.RLock()
_cnx = None

# Les écrans de la console : un administrateur ouvre l'application d'un ambassadeur avec une
# session à part, sur le compte de l'ambassadeur (visible dans ses appareils).
CONSOLE = "Console administrateur"
# Pendant une requête venue d'un écran de la console : qui agit (ex. « chef@ecole.fr »). Le
# journal le note sur chaque action, pour que l'on sache toujours qui a lancé quoi.
ORIGINE = contextvars.ContextVar("smartmail_origine", default="")

SCHEMA = """
CREATE TABLE IF NOT EXISTS utilisateurs (
  id INTEGER PRIMARY KEY,
  nom TEXT NOT NULL UNIQUE,
  jeton_hash TEXT NOT NULL UNIQUE,
  quota_mensuel INTEGER NOT NULL,
  actif INTEGER NOT NULL DEFAULT 1,
  cree TEXT NOT NULL,
  email TEXT,
  parametres TEXT,
  role TEXT NOT NULL DEFAULT 'ambassadeur'
);
CREATE TABLE IF NOT EXISTS usage (
  utilisateur_id INTEGER NOT NULL,
  mois TEXT NOT NULL,
  contacts_total INTEGER NOT NULL DEFAULT 0,
  contacts_ia INTEGER NOT NULL DEFAULT 0,
  jetons_entree INTEGER NOT NULL DEFAULT 0,
  jetons_sortie INTEGER NOT NULL DEFAULT 0,
  cout_usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (utilisateur_id, mois)
);
CREATE TABLE IF NOT EXISTS sessions (
  jeton_hash TEXT PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL,
  cree TEXT NOT NULL,
  appareil TEXT NOT NULL DEFAULT '',
  vu TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS outlook (
  utilisateur_id INTEGER PRIMARY KEY,
  adresse TEXT NOT NULL,
  etat TEXT NOT NULL,
  connecte TEXT NOT NULL,
  verifie TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS taches (
  utilisateur_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  statut TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  progression TEXT NOT NULL DEFAULT '{}',
  message TEXT NOT NULL DEFAULT '',
  maj TEXT NOT NULL,
  PRIMARY KEY (utilisateur_id, type)
);
CREATE TABLE IF NOT EXISTS travaux (
  utilisateur_id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  statut TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  progression TEXT NOT NULL DEFAULT '{}',
  message TEXT NOT NULL DEFAULT '',
  maj TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS destinataires (
  utilisateur_id INTEGER NOT NULL,
  adresse TEXT NOT NULL,
  nom TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  ordre INTEGER NOT NULL,
  PRIMARY KEY (utilisateur_id, adresse)
);
-- Toute personne à qui un ambassadeur a envoyé (ou va envoyer) le message : elle
-- n'est plus jamais collectée ni envoyée par personne. « reserve » : dans un envoi
-- en cours de ce compte ; « recu » : le message est parti.
CREATE TABLE IF NOT EXISTS contactes (
  adresse TEXT PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL,
  statut TEXT NOT NULL,
  quand REAL NOT NULL
);

-- Les contacts que le tri a écartés (pas des élèves), avec la raison : l'étudiant
-- peut les voir et ajouter quelqu'un quand même.
CREATE TABLE IF NOT EXISTS exclus (
  utilisateur_id INTEGER NOT NULL,
  adresse TEXT NOT NULL,
  nom TEXT NOT NULL DEFAULT '',
  groupe TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  raison TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  quand REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (utilisateur_id, adresse)
);

-- Tout ce que la recherche a extrait de l'annuaire (nom et adresse), avant tri.
CREATE TABLE IF NOT EXISTS extraits (
  utilisateur_id INTEGER NOT NULL,
  adresse TEXT NOT NULL,
  nom TEXT NOT NULL DEFAULT '',
  ordre INTEGER NOT NULL,
  PRIMARY KEY (utilisateur_id, adresse)
);

-- La logique de l'école, apprise sur TOUT l'annuaire extrait (« Garder seulement les
-- étudiants »). Tant qu'elle n'existe pas, la recherche extrait sans rien trier.
CREATE TABLE IF NOT EXISTS logiques (
  utilisateur_id INTEGER PRIMARY KEY,
  logique TEXT NOT NULL,
  quand REAL NOT NULL
);

-- Élèves retirés à la main pendant qu'ils étaient dans une campagne : Smart Mail les met
-- dans « Déjà envoyés » de l'extension pour qu'elle les saute (« saute »), et les en sort
-- s'ils sont rajoutés (« retabli »). Jamais quelqu'un qui a vraiment reçu le message.
CREATE TABLE IF NOT EXISTS acceptations (
    utilisateur_id INTEGER NOT NULL,
    version TEXT NOT NULL,
    empreinte TEXT NOT NULL,
    quand TEXT NOT NULL,
    ip TEXT NOT NULL DEFAULT '',
    appareil TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions_archive (
    utilisateur_id INTEGER NOT NULL,
    etat TEXT NOT NULL,
    raison TEXT NOT NULL DEFAULT '',
    quand TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_archive_uid ON sessions_archive(utilisateur_id, quand);
CREATE TABLE IF NOT EXISTS sauts (
  utilisateur_id INTEGER NOT NULL,
  adresse TEXT NOT NULL,
  etat TEXT NOT NULL,
  PRIMARY KEY (utilisateur_id, adresse)
);

CREATE TABLE IF NOT EXISTS recherches (
  utilisateur_id INTEGER PRIMARY KEY,
  etat TEXT NOT NULL,
  maj TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cache (
  adresse TEXT PRIMARY KEY,
  groupe TEXT NOT NULL,
  type TEXT NOT NULL,
  raison TEXT NOT NULL,
  source TEXT NOT NULL,
  date TEXT NOT NULL
);
-- Serveurs de messagerie des écoles trouvés par la connexion universelle (IMAP/SMTP/Zimbra),
-- par domaine : une école trouvée une fois n'est plus jamais sondée (évite les rafales de
-- connexions qui font bannir notre IP par les universités protégées).
-- Avis « non distribué » déjà vus dans la boîte de chaque compte (seulement leur identifiant) :
-- gardés d'un pack à l'autre, pour qu'un avis arrivé ENTRE deux mails (navigateur fermé) soit
-- bien lu comme nouveau au mail suivant (20/11 : AMOS bloqué en 5.1.8 sans que l'envoi s'arrête).
-- La ligne de clé vide marque que la boîte a déjà été relevée une première fois.
-- Le type de chaque adresse selon l'annuaire de l'école (personne, groupe, boîte partagée, absent) :
-- demandé une seule fois, pour ne jamais envoyer à un groupe (ses membres recevraient le mail en double).
CREATE TABLE IF NOT EXISTS types_annuaire (
  adresse TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  quand REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS avis_vus (
  utilisateur_id INTEGER NOT NULL,
  cle TEXT NOT NULL,
  quand REAL NOT NULL,
  PRIMARY KEY (utilisateur_id, cle)
);
CREATE TABLE IF NOT EXISTS config_ecoles (
  domaine TEXT PRIMARY KEY,
  config TEXT NOT NULL,
  maj TEXT NOT NULL
);
-- Le journal de la console d'administration : ce qui s'est passé chez chaque
-- ambassadeur (lancements, pauses, paliers, erreurs, connexions). Gardé 30 jours.
CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY,
  utilisateur_id INTEGER,
  quand REAL NOT NULL,
  type TEXT NOT NULL,
  niveau TEXT NOT NULL DEFAULT 'info',
  texte TEXT NOT NULL
);
"""


def maintenant():
    return datetime.now(timezone.utc)


def mois_courant():
    return maintenant().strftime("%Y-%m")


def cnx():
    global _cnx
    with _verrou:
        if _cnx is None:
            config.BASE.parent.mkdir(parents=True, exist_ok=True)
            _cnx = sqlite3.connect(str(config.BASE), check_same_thread=False, isolation_level=None)
            _cnx.row_factory = sqlite3.Row
            _cnx.execute("PRAGMA journal_mode=WAL")
            _cnx.executescript(SCHEMA)
            _migrer()
        return _cnx


# Colonnes ajoutées après la première version : les bases déjà en service sur le
# VPS sont mises à niveau sans perdre un compte ni une session.
_AJOUTS = [
    ("utilisateurs", "email", "TEXT"),
    ("utilisateurs", "parametres", "TEXT"),
    ("utilisateurs", "role", "TEXT NOT NULL DEFAULT 'ambassadeur'"),
    ("sessions", "appareil", "TEXT NOT NULL DEFAULT ''"),
    ("sessions", "vu", "TEXT NOT NULL DEFAULT ''"),
    ("outlook", "extension", "TEXT NOT NULL DEFAULT ''"),
    ("outlook", "messagerie", "TEXT NOT NULL DEFAULT 'outlook'"),  # outlook | gmail
    # Suivi de l'envoi, par élève : envoye, deja, envoi, verifier, echec ('' : pas encore).
    ("destinataires", "statut", "TEXT NOT NULL DEFAULT ''"),
    ("destinataires", "maj", "REAL NOT NULL DEFAULT 0"),
]


def _migrer():
    for table, colonne, definition in _AJOUTS:
        cols = {r[1] for r in _cnx.execute(f"PRAGMA table_info({table})")}
        if cols and colonne not in cols:
            _cnx.execute(f"ALTER TABLE {table} ADD COLUMN {colonne} {definition}")
    _cnx.execute("CREATE UNIQUE INDEX IF NOT EXISTS utilisateurs_email ON utilisateurs(email)")
    # Tri passé sur Claude Haiku (40 fois moins cher) : l'ancien quota par défaut est relevé.
    _cnx.execute("UPDATE utilisateurs SET quota_mensuel = 200000 WHERE quota_mensuel = 20000")
    # Première version : un seul travail par compte (table « travaux ») ; maintenant un
    # par type (recherche et envoi en parallèle). On reprend l'existant une fois.
    _cnx.execute("INSERT OR IGNORE INTO taches (utilisateur_id, type, statut, params, progression, message, maj) "
                 "SELECT utilisateur_id, type, statut, params, progression, message, maj FROM travaux "
                 "WHERE type IN ('annuaire', 'envoi')")
    _cnx.execute("DELETE FROM travaux")
    _cnx.execute("CREATE INDEX IF NOT EXISTS sessions_utilisateur ON sessions(utilisateur_id)")
    _cnx.execute("CREATE INDEX IF NOT EXISTS journal_utilisateur ON journal(utilisateur_id, id)")
    _cnx.execute("CREATE INDEX IF NOT EXISTS contactes_utilisateur ON contactes(utilisateur_id, statut, quand)")


def fermer():
    global _cnx
    with _verrou:
        if _cnx is not None:
            _cnx.close()
            _cnx = None


def hacher(jeton):
    return hashlib.sha256(jeton.encode()).hexdigest()


# ------------------------------------------------------------ utilisateurs
def creer_utilisateur(nom, quota):
    jeton = "sm_" + secrets.token_urlsafe(24)
    with _verrou:
        cnx().execute("INSERT INTO utilisateurs (nom, jeton_hash, quota_mensuel, cree) VALUES (?, ?, ?, ?)",
                      (nom, hacher(jeton), int(quota), maintenant().isoformat()))
    return jeton


def nouveau_code(nom):
    jeton = "sm_" + secrets.token_urlsafe(24)
    with _verrou:
        n = cnx().execute("UPDATE utilisateurs SET jeton_hash = ? WHERE nom = ?", (hacher(jeton), nom)).rowcount
    return jeton if n else None


def creer_compte(nom, email, role="ambassadeur", quota=None):
    """Compte nommé : un étudiant ambassadeur ou un administrateur. Il n'y a pas de
    mot de passe — la personne se connectera avec son compte Outlook, et c'est son
    adresse qui la ramène ici. Lève sqlite3.IntegrityError si le nom ou l'adresse est pris."""
    from . import config
    email = (email or "").strip().lower()
    with _verrou:
        cnx().execute(
            "INSERT INTO utilisateurs (nom, email, jeton_hash, quota_mensuel, cree, role) VALUES (?, ?, ?, ?, ?, ?)",
            (nom, email or None, hacher("inutilise_" + secrets.token_urlsafe(24)),
             int(config.QUOTA_PAR_DEFAUT if quota is None else quota), maintenant().isoformat(), role))
        return dict(cnx().execute("SELECT * FROM utilisateurs WHERE nom = ?", (nom,)).fetchone())


def utilisateur_par_email(email):
    with _verrou:
        r = cnx().execute("SELECT * FROM utilisateurs WHERE email = ?", ((email or "").strip().lower(),)).fetchone()
    return dict(r) if r else None


def utilisateur_par_id(uid):
    with _verrou:
        r = cnx().execute("SELECT * FROM utilisateurs WHERE id = ?", (uid,)).fetchone()
    return dict(r) if r else None


def definir_role(uid, role):
    with _verrou:
        return cnx().execute("UPDATE utilisateurs SET role = ? WHERE id = ?", (role, uid)).rowcount


def definir_quota(uid, quota):
    with _verrou:
        return cnx().execute("UPDATE utilisateurs SET quota_mensuel = ? WHERE id = ?", (int(quota), uid)).rowcount


def definir_actif(uid, actif):
    """Couper l'accès ferme aussi toutes les sessions ouvertes de ce compte."""
    with _verrou:
        n = cnx().execute("UPDATE utilisateurs SET actif = ? WHERE id = ?", (1 if actif else 0, uid)).rowcount
        if not actif:
            cnx().execute("DELETE FROM sessions WHERE utilisateur_id = ?", (uid,))
    return n


def administrateurs_actifs():
    with _verrou:
        return cnx().execute("SELECT COUNT(*) FROM utilisateurs WHERE role = 'administrateur' AND actif = 1").fetchone()[0]


# ------------------------------------------------------------ sessions (sur le serveur)
def ouvrir_session(uid, appareil=""):
    """Ouvre une session pour CET appareil, rattachée à ce seul compte. Les autres
    appareils restent connectés. Le jeton n'est stocké que haché."""
    jeton = "sm_" + secrets.token_urlsafe(24)
    t = maintenant().isoformat()
    with _verrou:
        cnx().execute("INSERT INTO sessions (jeton_hash, utilisateur_id, cree, appareil, vu) VALUES (?, ?, ?, ?, ?)",
                      (hacher(jeton), uid, t, (appareil or "")[:200], t))
    return jeton


def session_et_utilisateur(jeton):
    """(session, compte) d'un jeton de session, ou (None, compte) pour un code
    d'accès d'extension, ou (None, None). Une session expirée est supprimée."""
    from . import config
    if not jeton:
        return None, None
    h = hacher(jeton)
    with _verrou:
        s = cnx().execute("SELECT * FROM sessions WHERE jeton_hash = ?", (h,)).fetchone()
        if s:
            s = dict(s)
            limite = maintenant() - timedelta(days=config.SESSION_JOURS)
            if config.SESSION_JOURS > 0 and datetime.fromisoformat(s["vu"] or s["cree"]) < limite:
                cnx().execute("DELETE FROM sessions WHERE jeton_hash = ?", (h,))
                return None, None
            u = cnx().execute("SELECT * FROM utilisateurs WHERE id = ? AND actif = 1", (s["utilisateur_id"],)).fetchone()
            if not u:
                return None, None
            # Trace de vie, au plus une écriture par quart d'heure.
            if datetime.fromisoformat(s["vu"] or s["cree"]) < maintenant() - timedelta(minutes=15):
                cnx().execute("UPDATE sessions SET vu = ? WHERE jeton_hash = ?", (maintenant().isoformat(), h))
            return s, dict(u)
        u = cnx().execute("SELECT * FROM utilisateurs WHERE jeton_hash = ? AND actif = 1", (h,)).fetchone()
    return None, (dict(u) if u else None)


def utilisateur_par_jeton(jeton):
    """Code d'accès créé par l'administrateur, ou jeton de session (un par appareil connecté)."""
    return session_et_utilisateur(jeton)[1]


def sessions_lister(uid):
    with _verrou:
        return [dict(r) for r in cnx().execute(
            "SELECT jeton_hash, cree, appareil, vu FROM sessions WHERE utilisateur_id = ? ORDER BY vu DESC", (uid,))]


def connexion_par_email(email, nom="", quota=20000):
    """Trouve le compte de cette adresse ou le crée, puis ouvre une session pour CET appareil
    (les autres appareils restent connectés). Rend (jeton, utilisateur)."""
    email = email.strip().lower()
    with _verrou:
        r = cnx().execute("SELECT * FROM utilisateurs WHERE email = ?", (email,)).fetchone()
        if not r:
            cnx().execute("INSERT INTO utilisateurs (nom, email, jeton_hash, quota_mensuel, cree) VALUES (?, ?, ?, ?, ?)",
                          (nom or email, email, hacher("inutilise_" + secrets.token_urlsafe(24)), int(quota), maintenant().isoformat()))
            r = cnx().execute("SELECT * FROM utilisateurs WHERE email = ?", (email,)).fetchone()
        if not r["actif"]:
            return None, None
        u = dict(r)
    return ouvrir_session(u["id"], "démonstration"), u


def deconnecter(jeton):
    with _verrou:
        cnx().execute("DELETE FROM sessions WHERE jeton_hash = ?", (hacher(jeton),))


def deconnecter_tout(uid, sauf=None):
    """Ferme toutes les sessions du compte, sauf éventuellement celle d'ici.
    Rend le nombre d'appareils déconnectés."""
    with _verrou:
        if sauf:
            return cnx().execute("DELETE FROM sessions WHERE utilisateur_id = ? AND jeton_hash <> ?", (uid, sauf)).rowcount
        return cnx().execute("DELETE FROM sessions WHERE utilisateur_id = ?", (uid,)).rowcount


# ------------------------------------------------------------ session Outlook (gardée par le serveur)
def compte_outlook(email, role="ambassadeur", quota=None):
    """Le compte Smart Mail de cette adresse Outlook, créé à la première connexion.
    Rend (utilisateur, cree)."""
    from . import config
    email = (email or "").strip().lower()
    with _verrou:
        r = cnx().execute("SELECT * FROM utilisateurs WHERE email = ?", (email,)).fetchone()
        if r:
            return dict(r), False
        # Nom affiché unique : l'adresse, puis « adresse (2) » si elle sert déjà de nom.
        choisi, n = email, 1
        while cnx().execute("SELECT 1 FROM utilisateurs WHERE nom = ?", (choisi,)).fetchone():
            n += 1
            choisi = f"{email} ({n})"
        cnx().execute(
            "INSERT INTO utilisateurs (nom, email, jeton_hash, quota_mensuel, cree, role) VALUES (?, ?, ?, ?, ?, ?)",
            (choisi, email, hacher("inutilise_" + secrets.token_urlsafe(24)),
             int(config.QUOTA_PAR_DEFAUT if quota is None else quota), maintenant().isoformat(), role))
        return dict(cnx().execute("SELECT * FROM utilisateurs WHERE email = ?", (email,)).fetchone()), True


# ------------------------------------------------------------ historique des sessions
# Une session n'est jamais perdue par le serveur : avant d'être effacée ou remplacée (et toutes
# les 6 h quand Microsoft/Google la renouvelle), la version courante est archivée. On garde les
# 10 dernières par compte : de quoi la restaurer après une erreur (Neoma, McGill, 12/11).
ARCHIVES_MAX = 10


def _archiver(uid, raison, si_plus_vieille_que=None):
    """À appeler sous _verrou. Copie la session courante (si elle existe) dans l'historique."""
    r = cnx().execute("SELECT etat FROM outlook WHERE utilisateur_id = ? AND etat != ''", (uid,)).fetchone()
    if not r:
        return
    if si_plus_vieille_que is not None:
        der = cnx().execute("SELECT MAX(quand) FROM sessions_archive WHERE utilisateur_id = ?", (uid,)).fetchone()[0]
        if der and der > (maintenant() - si_plus_vieille_que).isoformat():
            return
    cnx().execute("INSERT INTO sessions_archive (utilisateur_id, etat, raison, quand) VALUES (?, ?, ?, ?)",
                  (uid, r[0], raison, maintenant().isoformat()))
    cnx().execute("""DELETE FROM sessions_archive WHERE utilisateur_id = ? AND rowid NOT IN (
                       SELECT rowid FROM sessions_archive WHERE utilisateur_id = ? ORDER BY quand DESC LIMIT ?)""",
                  (uid, uid, ARCHIVES_MAX))


def acceptation_noter(uid, version, empreinte, ip, appareil):
    """Preuve de l'acceptation des conditions d'utilisation (jamais effacée)."""
    with _verrou:
        cnx().execute("INSERT INTO acceptations (utilisateur_id, version, empreinte, quand, ip, appareil) VALUES (?, ?, ?, ?, ?, ?)",
                      (uid, version, empreinte, maintenant().isoformat(), (ip or "")[:64], (appareil or "")[:300]))


def acceptation_derniere(uid):
    with _verrou:
        r = cnx().execute("SELECT version, quand FROM acceptations WHERE utilisateur_id = ? ORDER BY quand DESC LIMIT 1", (uid,)).fetchone()
        return dict(r) if r else None


def sessions_archivees(uid):
    """[(rowid, raison, quand)] du plus récent au plus ancien (sans le contenu)."""
    with _verrou:
        return [tuple(x) for x in cnx().execute(
            "SELECT rowid, raison, quand FROM sessions_archive WHERE utilisateur_id = ? ORDER BY quand DESC", (uid,))]


def session_restaurer(uid, rowid):
    """Remet une session archivée comme session courante (la courante est archivée d'abord)."""
    with _verrou:
        r = cnx().execute("SELECT etat FROM sessions_archive WHERE utilisateur_id = ? AND rowid = ?", (uid, rowid)).fetchone()
        if not r:
            return False
        _archiver(uid, "avant restauration")
        cnx().execute("UPDATE outlook SET etat = ? WHERE utilisateur_id = ?", (r[0], uid))
        return True


def outlook_ecrire(uid, adresse, etat_chiffre, messagerie="outlook"):
    """Range la session du navigateur (cookies Outlook ou Gmail), déjà chiffrée par app.coffre."""
    t = maintenant().isoformat()
    with _verrou:
        _archiver(uid, "remplacée par une nouvelle connexion")
        cnx().execute(
            """INSERT INTO outlook (utilisateur_id, adresse, etat, connecte, verifie, messagerie) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(utilisateur_id) DO UPDATE SET adresse = excluded.adresse, etat = excluded.etat,
                 connecte = excluded.connecte, verifie = excluded.verifie, messagerie = excluded.messagerie""",
            (uid, adresse, etat_chiffre, t, t, messagerie))


def outlook_rafraichir(uid, etat_chiffre):
    """La session a servi et Microsoft a renouvelé ses cookies : on garde les nouveaux."""
    with _verrou:
        _archiver(uid, "renouvelée", si_plus_vieille_que=timedelta(hours=6))
        cnx().execute("UPDATE outlook SET etat = ?, verifie = ? WHERE utilisateur_id = ?",
                      (etat_chiffre, maintenant().isoformat(), uid))


def outlook_extension_ecrire(uid, etat_chiffre):
    """Mémoire de l'extension pour ce compte (campagne en cours, « Déjà envoyés »,
    relevé), chiffrée : le prochain travail du serveur reprend exactement là."""
    with _verrou:
        cnx().execute("UPDATE outlook SET extension = ? WHERE utilisateur_id = ?", (etat_chiffre, uid))


def outlook_lire(uid):
    with _verrou:
        r = cnx().execute("SELECT * FROM outlook WHERE utilisateur_id = ?", (uid,)).fetchone()
    return dict(r) if r and r["etat"] else None  # session oubliée : pas de session (la mémoire reste)


def outlook_infos(uid):
    """La session de messagerie sans ses données chiffrées (lecture légère, pour la console)."""
    with _verrou:
        r = cnx().execute("SELECT adresse, connecte, verifie, messagerie, etat != '' AS active FROM outlook "
                          "WHERE utilisateur_id = ?", (uid,)).fetchone()
    return dict(r) if r else None


def outlook_oublier(uid):
    """La session est oubliée (déconnexion, retrait de l'accès, session expirée). La mémoire
    de la recherche reste : à la reconnexion, tout reprend là où on en était."""
    with _verrou:
        _archiver(uid, "effacée (déconnexion ou expiration)")
        return cnx().execute("UPDATE outlook SET etat = '', verifie = '' WHERE utilisateur_id = ? AND etat != ''", (uid,)).rowcount


# ------------------------------------------------------------ mémoire du compte
# Deux parties dans la liste : « à envoyer » (branchée à la collecte) et « reçu ».
_A_ENVOYER = "statut IN ('', 'envoi', 'echec')"
_RECUS = "statut NOT IN ('', 'envoi', 'echec')"
_PARTIES = {"a_envoyer": " AND " + _A_ENVOYER, "recus": " AND " + _RECUS, None: ""}


def destinataires_ajouter(uid, personnes):
    """personnes : [{adresse, nom, source}]. Ni les adresses déjà dans la liste, ni
    celles qui ont déjà reçu le message (de ce compte ou d'un autre ambassadeur) :
    une même personne ne sert jamais deux fois. Rend le nombre d'élèves à envoyer."""
    with _verrou:
        n = cnx().execute("SELECT COALESCE(MAX(ordre), 0) FROM destinataires WHERE utilisateur_id = ?", (uid,)).fetchone()[0]
        lignes = []
        for p in personnes:
            n += 1
            a = p["adresse"].strip().lower()
            lignes.append((uid, a, (p.get("nom") or "")[:200], (p.get("source") or "")[:20], n, a))
        cnx().executemany("INSERT OR IGNORE INTO destinataires (utilisateur_id, adresse, nom, source, ordre) "
                          "SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM contactes WHERE adresse = ?)", lignes)
        return cnx().execute("SELECT COUNT(*) FROM destinataires WHERE utilisateur_id = ? AND " + _A_ENVOYER, (uid,)).fetchone()[0]


def destinataires_nouveaux(uid, personnes):
    """Ceux qui ne sont ni dans la liste, ni déjà contactés ; et combien étaient déjà contactés."""
    gardes, contactes = [], 0
    with _verrou:
        for p in personnes:
            a = p["adresse"].strip().lower()
            if cnx().execute("SELECT 1 FROM contactes WHERE adresse = ?", (a,)).fetchone():
                contactes += 1
            elif not cnx().execute("SELECT 1 FROM destinataires WHERE utilisateur_id = ? AND adresse = ?", (uid, a)).fetchone():
                gardes.append(p)
    return gardes, contactes


def reserver(uid, adresses):
    """Avant un envoi : chaque élève est réservé pour CE compte. Rend ceux qu'un autre
    ambassadeur a déjà (réservés ou servis) : on ne leur envoie pas."""
    t = time.time()
    with _verrou:
        cnx().executemany("INSERT OR IGNORE INTO contactes (adresse, utilisateur_id, statut, quand) VALUES (?, ?, 'reserve', ?)",
                          [(a.lower(), uid, t) for a in adresses])
        pris = set()
        for a in adresses:
            r = cnx().execute("SELECT utilisateur_id FROM contactes WHERE adresse = ?", (a.lower(),)).fetchone()
            if r and r[0] != uid:
                pris.add(a.lower())
    return pris


def marquer_recus(uid, adresses):
    """Le message est parti (ou peut-être parti) : ces personnes sont servies pour toujours."""
    t = time.time()
    with _verrou:
        cnx().executemany("INSERT INTO contactes (adresse, utilisateur_id, statut, quand) VALUES (?, ?, 'recu', ?) "
                          "ON CONFLICT(adresse) DO UPDATE SET statut = 'recu', quand = excluded.quand "
                          "WHERE contactes.utilisateur_id = excluded.utilisateur_id",
                          [(a.lower(), uid, t) for a in adresses])


def destinataires_lister(uid, depart=0, taille=500, partie=None):
    with _verrou:
        return [dict(r) for r in cnx().execute(
            "SELECT adresse, nom, source, statut FROM destinataires WHERE utilisateur_id = ?" + _PARTIES[partie] + " ORDER BY ordre LIMIT ? OFFSET ?",
            (uid, taille, depart))]


def destinataires_statuer(uid, statuts):
    """Note où en est chaque élève dans l'envoi ({adresse: statut}, sans tenir compte de
    la casse). Quelqu'un qui a reçu le message le garde : un envoi suivant qui le
    saute (« deja ») ne l'efface pas. Rend le nombre de lignes changées."""
    if not statuts:
        return 0
    t = time.time()
    voulus = {str(a).lower(): s for a, s in statuts.items()}
    with _verrou:
        lignes = cnx().execute("SELECT adresse, statut FROM destinataires WHERE utilisateur_id = ?", (uid,)).fetchall()
        changes = []
        for adresse, actuel in lignes:
            s = voulus.get(adresse.lower())
            if s is None or s == actuel or (actuel == "envoye" and s in ("deja", "")):
                continue
            changes.append((s, t, uid, adresse))
        if changes:
            cnx().executemany("UPDATE destinataires SET statut = ?, maj = ? WHERE utilisateur_id = ? AND adresse = ?", changes)
        return len(changes)


def destinataires_suivi(uid, depuis=0.0):
    """Les élèves dont le statut a changé depuis « depuis » (horodatage serveur ; bornes
    comprises : un changement écrit au même instant n'est jamais manqué, et le
    rejouer ne change rien)."""
    with _verrou:
        lignes = cnx().execute("SELECT adresse, statut, maj FROM destinataires WHERE utilisateur_id = ? AND maj > 0 AND maj >= ? ORDER BY maj",
                               (uid, float(depuis))).fetchall()
    return [{"adresse": a, "statut": s} for a, s, _ in lignes], max([m for _, _, m in lignes], default=float(depuis))


def destinataires_compter(uid, partie=None):
    with _verrou:
        return cnx().execute("SELECT COUNT(*) FROM destinataires WHERE utilisateur_id = ?" + _PARTIES[partie], (uid,)).fetchone()[0]


def exclus_noter(uid, lignes):
    """lignes : [(adresse, nom, groupe, type, raison, source)]. Jamais quelqu'un qui est
    déjà dans la liste des élèves."""
    if not lignes:
        return
    t = time.time()
    with _verrou:
        cnx().executemany(
            "INSERT INTO exclus (utilisateur_id, adresse, nom, groupe, type, raison, source, quand) "
            "SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM destinataires WHERE utilisateur_id = ? AND adresse = ?) "
            "ON CONFLICT(utilisateur_id, adresse) DO UPDATE SET nom = excluded.nom, groupe = excluded.groupe, type = excluded.type, "
            "raison = excluded.raison, source = excluded.source",
            [(uid, a.lower(), (n or "")[:200], g, ty, (r or "")[:200], s, t, uid, a.lower()) for a, n, g, ty, r, s in lignes])


def adresses_triees(uid):
    """Tout ce qui est déjà trié pour ce compte (dans la liste ou dans « Exclus ») : une recherche
    qui reprend ne le retrie jamais (une décision prise n'est plus remise en cause par la machine)."""
    with _verrou:
        a = {r[0] for r in cnx().execute("SELECT adresse FROM destinataires WHERE utilisateur_id = ?", (uid,))}
        a |= {r[0] for r in cnx().execute("SELECT adresse FROM exclus WHERE utilisateur_id = ?", (uid,))}
    return {x.lower() for x in a}


def destinataires_retirer_surs(uid, resultats):
    """Un contact encore « à envoyer » qu'une règle sûre (passerelle SMS, boîte de service…)
    ou le garde-fou de domaine désigne comme non-élève passe dans « Exclus ». Jamais ce qui
    est déjà parti, ajouté à la main, ou réservé pour un envoi en cours. Rend le nombre retiré."""
    retires = 0
    t = time.time()
    with _verrou:
        for r in resultats:
            # Seule une règle sûre (passerelle SMS, boîte de service) retire quelqu'un de la liste.
            # Jamais une déduction (repères, garde-fou de domaine) : elle peut se tromper en bloc.
            if r.get("source") != "regle":
                continue
            a = r["adresse"].lower()
            ligne = cnx().execute("SELECT nom FROM destinataires WHERE utilisateur_id = ? AND adresse = ? AND statut = '' "
                                  "AND source != 'manuel'", (uid, a)).fetchone()
            if not ligne or cnx().execute("SELECT 1 FROM contactes WHERE adresse = ?", (a,)).fetchone():
                continue
            cnx().execute("DELETE FROM destinataires WHERE utilisateur_id = ? AND adresse = ?", (uid, a))
            cnx().execute("INSERT INTO exclus (utilisateur_id, adresse, nom, groupe, type, raison, source, quand) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                          "ON CONFLICT(utilisateur_id, adresse) DO UPDATE SET groupe = excluded.groupe, type = excluded.type, "
                          "raison = excluded.raison, source = excluded.source",
                          (uid, a, ligne[0], r["groupe"], r["type"], r["raison"], "garde" if r.get("garde") else r["source"], t))
            retires += 1
    return retires


def recus_par_jour(uid=None, jours=14, fuseau="Europe/Paris"):
    """Combien de personnes ont reçu le message, jour par jour (du plus ancien à aujourd'hui)."""
    from zoneinfo import ZoneInfo
    tz = ZoneInfo(fuseau)
    aujourd_hui = datetime.now(tz).date()
    debut = datetime.combine(aujourd_hui - timedelta(days=jours - 1), datetime.min.time(), tz).timestamp()
    q, a = "SELECT quand FROM contactes WHERE statut = 'recu' AND quand >= ?", [debut]
    if uid is not None:
        q, a = q + " AND utilisateur_id = ?", a + [uid]
    with _verrou:
        quands = [r[0] for r in cnx().execute(q, a)]
    compte = {}
    for t in quands:
        j = datetime.fromtimestamp(t, tz).date()
        compte[j] = compte.get(j, 0) + 1
    return [{"jour": (aujourd_hui - timedelta(days=k)).isoformat(), "n": compte.get(aujourd_hui - timedelta(days=k), 0)}
            for k in range(jours - 1, -1, -1)]


def derniers_servis(uid, taille=15):
    """Les dernières personnes de la liste dont l'envoi a avancé (reçu, à vérifier, non distribué…)."""
    with _verrou:
        return [dict(r) for r in cnx().execute(
            "SELECT adresse, nom, statut, maj FROM destinataires WHERE utilisateur_id = ? AND " + _RECUS +
            " AND maj IS NOT NULL ORDER BY maj DESC LIMIT ?", (uid, taille))]


def types_lire(adresses):
    """{adresse: type} pour celles dont l'annuaire a déjà donné le type."""
    adresses = [a.lower() for a in adresses]
    connus = {}
    with _verrou:
        for i in range(0, len(adresses), 500):
            lot = adresses[i:i + 500]
            for a, t in cnx().execute("SELECT adresse, type FROM types_annuaire WHERE adresse IN (%s)" % ",".join("?" * len(lot)), lot):
                connus[a] = t
    return connus


def types_noter(types):
    t = time.time()
    with _verrou:
        cnx().executemany("INSERT INTO types_annuaire (adresse, type, quand) VALUES (?, ?, ?) "
                          "ON CONFLICT(adresse) DO UPDATE SET type = excluded.type, quand = excluded.quand",
                          [(a.lower(), ty, t) for a, ty in types.items() if ty])


def avis_vus_lire(uid):
    """Les avis « non distribué » déjà vus dans la boîte de ce compte, ou None si elle n'a encore
    jamais été relevée (les avis qui s'y trouvent alors datent d'avant Smart Mail)."""
    with _verrou:
        cles = {r[0] for r in cnx().execute("SELECT cle FROM avis_vus WHERE utilisateur_id = ?", (uid,))}
    if not cles:
        return None
    cles.discard("")
    return cles


def avis_vus_ajouter(uid, cles):
    """Note des avis comme vus (et que la boîte a été relevée). Garde les 2 000 derniers par compte."""
    t = time.time()
    with _verrou:
        cnx().executemany("INSERT INTO avis_vus (utilisateur_id, cle, quand) VALUES (?, ?, ?) "
                          "ON CONFLICT(utilisateur_id, cle) DO NOTHING", [(uid, c, t) for c in {""} | set(cles)])
        cnx().execute("DELETE FROM avis_vus WHERE utilisateur_id = ? AND cle != '' AND cle NOT IN "
                      "(SELECT cle FROM avis_vus WHERE utilisateur_id = ? ORDER BY quand DESC LIMIT 2000)", (uid, uid))


def journal_noter(uid, type_, texte, niveau="info"):
    """Une ligne du journal de la console (jamais d'adresse d'élève dedans : des nombres)."""
    t = time.time()
    if ORIGINE.get() and uid is not None:
        texte = f"{texte} (depuis la console, par {ORIGINE.get()})"
    with _verrou:
        r = cnx().execute("INSERT INTO journal (utilisateur_id, quand, type, niveau, texte) VALUES (?, ?, ?, ?, ?)",
                          (uid, t, type_, niveau, (texte or "")[:600]))
        if r.lastrowid % 200 == 0:
            cnx().execute("DELETE FROM journal WHERE quand < ?", (t - 30 * 86400,))


def journal_lire(uid=None, avant=None, taille=50, problemes=False):
    """Du plus récent au plus ancien ; « avant » : l'id de la dernière ligne déjà vue."""
    q, a = ("SELECT j.id, j.utilisateur_id, j.quand, j.type, j.niveau, j.texte, u.email FROM journal j "
            "LEFT JOIN utilisateurs u ON u.id = j.utilisateur_id WHERE 1 = 1"), []
    if uid is not None:
        q, a = q + " AND j.utilisateur_id = ?", a + [uid]
    if avant:
        q, a = q + " AND j.id < ?", a + [int(avant)]
    if problemes:
        q += " AND j.niveau IN ('attention', 'critique')"
    with _verrou:
        return [dict(r) for r in cnx().execute(q + " ORDER BY j.id DESC LIMIT ?", a + [int(taille)])]


def derniere_activite(uid):
    """La dernière fois que l'ambassadeur lui-même a utilisé l'application (pas la console)."""
    with _verrou:
        r = cnx().execute("SELECT MAX(vu) FROM sessions WHERE utilisateur_id = ? AND appareil NOT LIKE ?",
                          (uid, CONSOLE + "%")).fetchone()
    return r[0] if r else None


def sessions_console_fermer(uid=None, appareil=None, heures=None):
    """Ferme des sessions ouvertes par la console (d'un compte, d'un administrateur, ou plus
    vieilles que « heures »). Jamais une vraie session de l'ambassadeur."""
    q, a = "DELETE FROM sessions WHERE appareil LIKE ?", [CONSOLE + "%"]
    if uid is not None:
        q, a = q + " AND utilisateur_id = ?", a + [uid]
    if appareil:
        q, a = q + " AND appareil = ?", a + [appareil]
    if heures:
        q, a = q + " AND cree < ?", a + [(maintenant() - timedelta(hours=heures)).isoformat()]
    with _verrou:
        return cnx().execute(q, a).rowcount


def sessions_console_compter(uid, appareil, minutes):
    with _verrou:
        return cnx().execute("SELECT COUNT(*) FROM sessions WHERE utilisateur_id = ? AND appareil = ? AND cree > ?",
                             (uid, appareil, (maintenant() - timedelta(minutes=minutes)).isoformat())).fetchone()[0]


def destinataires_retirer_main(uid, adresses):
    """L'étudiant retire des élèves de sa liste « À envoyer » : ils passent dans « Exclus »
    (on peut les rajouter), leur réservation est libérée, et une campagne en cours les sautera.
    Jamais quelqu'un qui a déjà reçu le message. Rend les adresses retirées."""
    retirees = []
    t = time.time()
    with _verrou:
        for a in {x.strip().lower() for x in adresses}:
            ligne = cnx().execute("SELECT nom FROM destinataires WHERE utilisateur_id = ? AND adresse = ? AND statut IN ('', 'echec')",
                                  (uid, a)).fetchone()
            if not ligne:
                continue
            cnx().execute("DELETE FROM destinataires WHERE utilisateur_id = ? AND adresse = ?", (uid, a))
            cnx().execute("DELETE FROM contactes WHERE adresse = ? AND utilisateur_id = ? AND statut = 'reserve'", (a, uid))
            cnx().execute("INSERT INTO exclus (utilisateur_id, adresse, nom, groupe, type, raison, source, quand) "
                          "VALUES (?, ?, ?, 'hors', 'retire', 'retiré à la main par l''étudiant', 'manuel', ?) "
                          "ON CONFLICT(utilisateur_id, adresse) DO UPDATE SET groupe = 'hors', type = 'retire', "
                          "raison = excluded.raison, source = 'manuel', quand = excluded.quand", (uid, a, ligne[0], t))
            cnx().execute("INSERT INTO sauts (utilisateur_id, adresse, etat) VALUES (?, ?, 'saute') "
                          "ON CONFLICT(utilisateur_id, adresse) DO UPDATE SET etat = 'saute'", (uid, a))
            retirees.append(a)
    return retirees


def sauts_retablir(uid, adresses):
    """Rajoutés après un retrait : la campagne ne doit plus les sauter."""
    with _verrou:
        cnx().executemany("UPDATE sauts SET etat = 'retabli' WHERE utilisateur_id = ? AND adresse = ?", [(uid, a.lower()) for a in adresses])


def sauts_lire(uid):
    """({à sauter}, {à rétablir})."""
    with _verrou:
        lignes = cnx().execute("SELECT adresse, etat FROM sauts WHERE utilisateur_id = ?", (uid,)).fetchall()
    return {a for a, e in lignes if e == "saute"}, {a for a, e in lignes if e == "retabli"}


def sauts_effacer_retablis(uid, adresses):
    with _verrou:
        cnx().executemany("DELETE FROM sauts WHERE utilisateur_id = ? AND adresse = ? AND etat = 'retabli'", [(uid, a) for a in adresses])


def destinataires_presents(uid, adresses):
    adresses = [a.lower() for a in adresses]
    with _verrou:
        return {r[0] for k in range(0, len(adresses), 500) for r in cnx().execute(
            "SELECT adresse FROM destinataires WHERE utilisateur_id = ? AND adresse IN (" + ",".join("?" * len(adresses[k:k + 500])) + ")",
            [uid] + adresses[k:k + 500])}


def exclus_retirer(uid, adresses):
    with _verrou:
        cnx().executemany("DELETE FROM exclus WHERE utilisateur_id = ? AND adresse = ?", [(uid, a.lower()) for a in adresses])


def exclus_compter(uid):
    with _verrou:
        return cnx().execute("SELECT COUNT(*) FROM exclus WHERE utilisateur_id = ?", (uid,)).fetchone()[0]


def _genre_exclu(groupe, type_):
    return "incertain" if groupe == "incertain" else (type_ or "autre")


def exclus_lister(uid, depart=0, taille=200, genre=None):
    """Les exclus, les plus récents d'abord ; « genre » : incertain, personnel, service…"""
    sql, args = "SELECT adresse, nom, groupe, type, raison FROM exclus WHERE utilisateur_id = ?", [uid]
    if genre == "incertain":
        sql += " AND groupe = 'incertain'"
    elif genre:
        sql += " AND groupe != 'incertain' AND type = ?"
        args.append(genre)
    sql += " ORDER BY quand DESC, adresse LIMIT ? OFFSET ?"
    with _verrou:
        lignes = cnx().execute(sql, args + [taille, depart]).fetchall()
    return [{"adresse": a, "nom": n, "genre": _genre_exclu(g, ty), "raison": r} for a, n, g, ty, r in lignes]


def exclus_par_genre(uid):
    with _verrou:
        lignes = cnx().execute("SELECT groupe, type, COUNT(*) FROM exclus WHERE utilisateur_id = ? GROUP BY groupe, type", (uid,)).fetchall()
    sortie = {}
    for g, ty, n in lignes:
        k = _genre_exclu(g, ty)
        sortie[k] = sortie.get(k, 0) + n
    return sortie


def exclus_lire(uid, adresses):
    with _verrou:
        return {r[0]: r[1] for r in cnx().execute(
            "SELECT adresse, nom FROM exclus WHERE utilisateur_id = ? AND adresse IN (" + ",".join("?" * len(adresses)) + ")",
            [uid] + [a.lower() for a in adresses])} if adresses else {}


_SECOND_NIVEAU = {"co", "ac", "edu", "gov", "org", "com", "net", "gouv"}


def ecole(domaine):
    """Le domaine de l'école : mail.mcgill.ca → mcgill.ca ; etu.univ-lille.fr → univ-lille.fr ;
    student.uni.ac.uk → uni.ac.uk."""
    parts = domaine.lower().split(".")
    n = 3 if len(parts) >= 3 and parts[-2] in _SECOND_NIVEAU and len(parts[-1]) == 2 else 2
    return ".".join(parts[-n:])


_RE_SOUS_DOMAINE_ETUDIANT = re.compile(r"^(mail|etu|etud|etudiant|etudiants|student|students|stu|eleve|eleves|learner|learners)\.")


def reperes_eleves(uid, par_domaine=5, domaines=4, minimum=3, part=0.25):
    """Exemples d'élèves déjà trouvés pour ce compte, par domaine : ils aident le tri à
    reconnaître le format des adresses étudiantes de l'école. Seuls les domaines qui
    pèsent au moins « part » des élèves comptent : quelques erreurs isolées (un membre du
    personnel pris pour un élève) ne doivent jamais devenir un repère."""
    with _verrou:
        lignes = [r[0] for r in cnx().execute(
            "SELECT adresse FROM destinataires WHERE utilisateur_id = ? AND source != 'manuel' ORDER BY ordre DESC LIMIT 3000", (uid,))]
    par_dom = {}
    for a in lignes:
        par_dom.setdefault(a.split("@", 1)[-1], []).append(a)
    total = max(1, len(lignes))
    choisis = sorted((d for d, l in par_dom.items() if len(l) >= minimum and len(l) / total >= part),
                     key=lambda d: -len(par_dom[d]))
    # Une école = un domaine étudiant. Un sous-domaine étudiant (mail., etu., student.…) l'emporte
    # toujours sur les autres domaines de l'école ; sinon, celui qui a le plus d'élèves (jamais
    # mcgill.ca face à mail.mcgill.ca, même si des erreurs passées y ont mis du personnel).
    choisis.sort(key=lambda d: (not _RE_SOUS_DOMAINE_ETUDIANT.match(d), -len(par_dom[d])))
    vus, gardes = set(), []
    for d in choisis:
        if ecole(d) not in vus:
            vus.add(ecole(d))
            gardes.append(d)
    choisis = gardes[:domaines]
    return {d: par_dom[d][:par_domaine] for d in choisis}


def extraits_ajouter(uid, personnes):
    """personnes : [{adresse, nom}] ; les adresses déjà extraites sont ignorées. Rend le total."""
    with _verrou:
        n = cnx().execute("SELECT COALESCE(MAX(ordre), 0) FROM extraits WHERE utilisateur_id = ?", (uid,)).fetchone()[0]
        cnx().executemany("INSERT OR IGNORE INTO extraits (utilisateur_id, adresse, nom, ordre) VALUES (?, ?, ?, ?)",
                          [(uid, p["adresse"].strip().lower(), (p.get("nom") or "")[:200], n + i + 1) for i, p in enumerate(personnes)])
        return cnx().execute("SELECT COUNT(*) FROM extraits WHERE utilisateur_id = ?", (uid,)).fetchone()[0]


_NON_TRIE = ("NOT EXISTS (SELECT 1 FROM destinataires d WHERE d.utilisateur_id = e.utilisateur_id AND d.adresse = e.adresse) "
             "AND NOT EXISTS (SELECT 1 FROM exclus x WHERE x.utilisateur_id = e.utilisateur_id AND x.adresse = e.adresse)")


def extraits_compter(uid, non_tries=False):
    with _verrou:
        return cnx().execute("SELECT COUNT(*) FROM extraits e WHERE e.utilisateur_id = ?" + (" AND " + _NON_TRIE if non_tries else ""),
                             (uid,)).fetchone()[0]


def extraits_lister(uid, depart=0, taille=500, non_tries=False):
    with _verrou:
        return [{"adresse": a, "nom": n} for a, n in cnx().execute(
            "SELECT adresse, nom FROM extraits e WHERE e.utilisateur_id = ?" + (" AND " + _NON_TRIE if non_tries else "")
            + " ORDER BY ordre LIMIT ? OFFSET ?", (uid, taille, depart))]


def logique_lire(uid):
    with _verrou:
        r = cnx().execute("SELECT logique FROM logiques WHERE utilisateur_id = ?", (uid,)).fetchone()
    return json.loads(r[0]) if r else None


def logique_ecrire(uid, logique):
    with _verrou:
        cnx().execute("INSERT INTO logiques (utilisateur_id, logique, quand) VALUES (?, ?, ?) ON CONFLICT(utilisateur_id) "
                      "DO UPDATE SET logique = excluded.logique, quand = excluded.quand", (uid, json.dumps(logique), time.time()))


def config_ecole_lire(domaine):
    with _verrou:
        r = cnx().execute("SELECT config FROM config_ecoles WHERE domaine = ?", (domaine.lower(),)).fetchone()
    return json.loads(r[0]) if r else None


def config_ecole_ecrire(domaine, config):
    with _verrou:
        cnx().execute("INSERT INTO config_ecoles (domaine, config, maj) VALUES (?, ?, ?) ON CONFLICT(domaine) "
                      "DO UPDATE SET config = excluded.config, maj = excluded.maj",
                      (domaine.lower(), json.dumps(config), maintenant().isoformat()))


def destinataires_vider(uid):
    """Nouvelle recherche : on retire ceux à qui on n'a pas encore envoyé (et on les
    libère pour les autres ambassadeurs). Ceux qui ont reçu le message restent dans
    « Reçu », pour toujours."""
    with _verrou:
        a_retirer = [r[0] for r in cnx().execute(
            "SELECT adresse FROM destinataires WHERE utilisateur_id = ? AND " + _A_ENVOYER, (uid,))]
        cnx().executemany("DELETE FROM contactes WHERE adresse = ? AND utilisateur_id = ? AND statut = 'reserve'",
                          [(a, uid) for a in a_retirer])
        cnx().execute("DELETE FROM destinataires WHERE utilisateur_id = ? AND " + _A_ENVOYER, (uid,))
        cnx().execute("DELETE FROM exclus WHERE utilisateur_id = ?", (uid,))
        cnx().execute("DELETE FROM extraits WHERE utilisateur_id = ?", (uid,))
        cnx().execute("DELETE FROM logiques WHERE utilisateur_id = ?", (uid,))
        cnx().execute("DELETE FROM recherches WHERE utilisateur_id = ?", (uid,))


def recherche_lire(uid):
    with _verrou:
        r = cnx().execute("SELECT etat FROM recherches WHERE utilisateur_id = ?", (uid,)).fetchone()
    return json.loads(r[0]) if r else None


def recherche_ecrire(uid, etat):
    with _verrou:
        cnx().execute("INSERT INTO recherches (utilisateur_id, etat, maj) VALUES (?, ?, ?) "
                      "ON CONFLICT(utilisateur_id) DO UPDATE SET etat = excluded.etat, maj = excluded.maj",
                      (uid, json.dumps(etat, ensure_ascii=False), maintenant().isoformat()))


def parametres_lire(uid):
    with _verrou:
        r = cnx().execute("SELECT parametres FROM utilisateurs WHERE id = ?", (uid,)).fetchone()
    return json.loads(r[0]) if r and r[0] else None


def parametres_ecrire(uid, p):
    with _verrou:
        cnx().execute("UPDATE utilisateurs SET parametres = ? WHERE id = ?", (json.dumps(p, ensure_ascii=False), uid))


def modifier(nom, **champs):
    cles = [k for k in champs if k in ("quota_mensuel", "actif")]
    if not cles:
        return 0
    with _verrou:
        n = cnx().execute(
            "UPDATE utilisateurs SET " + ", ".join(k + " = ?" for k in cles) + " WHERE nom = ?",
            [champs[k] for k in cles] + [nom]).rowcount
        if n and "actif" in champs and not champs["actif"]:
            # Accès coupé : tous ses appareils sont déconnectés sur-le-champ.
            cnx().execute("DELETE FROM sessions WHERE utilisateur_id = (SELECT id FROM utilisateurs WHERE nom = ?)", (nom,))
        return n


def utilisateurs():
    with _verrou:
        return [dict(r) for r in cnx().execute(
            "SELECT id, nom, email, role, quota_mensuel, actif, cree FROM utilisateurs ORDER BY nom")]


# ------------------------------------------------------------ consommation
def usage(uid, mois=None):
    mois = mois or mois_courant()
    with _verrou:
        r = cnx().execute("SELECT * FROM usage WHERE utilisateur_id = ? AND mois = ?", (uid, mois)).fetchone()
    return dict(r) if r else {"utilisateur_id": uid, "mois": mois, "contacts_total": 0, "contacts_ia": 0,
                              "jetons_entree": 0, "jetons_sortie": 0, "cout_usd": 0.0}


def ajouter_usage(uid, contacts_total=0, contacts_ia=0, jetons_entree=0, jetons_sortie=0, cout_usd=0.0):
    mois = mois_courant()
    with _verrou:
        cnx().execute(
            """INSERT INTO usage (utilisateur_id, mois, contacts_total, contacts_ia, jetons_entree, jetons_sortie, cout_usd)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(utilisateur_id, mois) DO UPDATE SET
                 contacts_total = contacts_total + excluded.contacts_total,
                 contacts_ia = contacts_ia + excluded.contacts_ia,
                 jetons_entree = jetons_entree + excluded.jetons_entree,
                 jetons_sortie = jetons_sortie + excluded.jetons_sortie,
                 cout_usd = cout_usd + excluded.cout_usd""",
            (uid, mois, contacts_total, contacts_ia, jetons_entree, jetons_sortie, cout_usd))


def depense_du_mois():
    with _verrou:
        r = cnx().execute("SELECT COALESCE(SUM(cout_usd), 0) FROM usage WHERE mois = ?", (mois_courant(),)).fetchone()
    return float(r[0])


def rapport(mois=None):
    mois = mois or mois_courant()
    with _verrou:
        return [dict(r) for r in cnx().execute(
            """SELECT u.id, u.nom, u.email, u.role, u.actif, u.quota_mensuel, u.cree,
                      COALESCE(g.contacts_total, 0) AS contacts_total,
                      COALESCE(g.contacts_ia, 0) AS contacts_ia, COALESCE(g.cout_usd, 0) AS cout_usd,
                      (SELECT COUNT(*) FROM sessions s WHERE s.utilisateur_id = u.id AND s.appareil NOT LIKE 'Console administrateur%') AS appareils,
                      (SELECT COUNT(*) FROM outlook o WHERE o.utilisateur_id = u.id AND o.etat != '') AS outlook,
                      (SELECT COUNT(*) FROM destinataires d WHERE d.utilisateur_id = u.id) AS destinataires
               FROM utilisateurs u LEFT JOIN usage g ON g.utilisateur_id = u.id AND g.mois = ?
               ORDER BY u.nom""", (mois,))]


# ------------------------------------------------------------ cache des tris
def cache_lire(adresses):
    if not adresses:
        return {}
    limite = (maintenant() - timedelta(days=config.CACHE_JOURS)).isoformat()
    sortie = {}
    with _verrou:
        liste = list(adresses)
        for k in range(0, len(liste), 500):
            morceau = liste[k:k + 500]
            q = "SELECT * FROM cache WHERE date >= ? AND adresse IN (" + ",".join("?" * len(morceau)) + ")"
            for r in cnx().execute(q, [limite] + morceau):
                sortie[r["adresse"]] = (r["groupe"], r["type"], r["raison"], r["source"])
    return sortie


def cache_ecrire(lignes):
    """lignes : [(adresse, groupe, type, raison, source)]"""
    if not lignes:
        return
    date = maintenant().isoformat()
    with _verrou:
        cnx().executemany(
            "INSERT INTO cache (adresse, groupe, type, raison, source, date) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(adresse) DO UPDATE SET groupe = excluded.groupe, type = excluded.type, "
            "raison = excluded.raison, source = excluded.source, date = excluded.date",
            [(a, g, t, r, s, date) for a, g, t, r, s in lignes])


def session_fermer(uid, ref):
    """Ferme UNE session de CE compte (ref = début de son empreinte, tel que
    montré dans « Mes appareils »). Une session d'un autre compte est intouchable."""
    if not ref or len(ref) < 8:
        return 0
    with _verrou:
        return cnx().execute("DELETE FROM sessions WHERE utilisateur_id = ? AND substr(jeton_hash, 1, ?) = ?",
                             (uid, len(ref), ref)).rowcount


# ------------------------------------------------------------ travaux du serveur
# Par compte, un état pour la recherche (« annuaire ») et un pour l'envoi : les deux
# peuvent tourner en même temps.
def travail_ecrire(uid, type_, statut, params=None, progression=None, message=""):
    with _verrou:
        cnx().execute(
            """INSERT INTO taches (utilisateur_id, type, statut, params, progression, message, maj) VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(utilisateur_id, type) DO UPDATE SET statut = excluded.statut, params = excluded.params,
                 progression = excluded.progression, message = excluded.message, maj = excluded.maj""",
            (uid, type_, statut, json.dumps(params or {}, ensure_ascii=False), json.dumps(progression or {}, ensure_ascii=False),
             message or "", maintenant().isoformat()))


def travail_lire(uid, type_):
    with _verrou:
        r = cnx().execute("SELECT * FROM taches WHERE utilisateur_id = ? AND type = ?", (uid, type_)).fetchone()
    if not r:
        return None
    t = dict(r)
    t["params"] = json.loads(t["params"] or "{}")
    t["progression"] = json.loads(t["progression"] or "{}")
    return t


def travaux_a_reprendre():
    """Travaux interrompus par un redémarrage du serveur : [(uid, type)]."""
    with _verrou:
        return [(r[0], r[1]) for r in cnx().execute(
            "SELECT utilisateur_id, type FROM taches WHERE statut IN ('en_cours', 'attente')")]


def outlook_extension_fusionner(uid, nouvelle, garder):
    """Range la part de la mémoire de l'extension qui revient à CE travail (garder(clé)
    vrai), sans toucher à celle de l'autre travail qui tourne peut-être en même temps."""
    from . import coffre
    # Le verrou de la base n'est tenu que pour lire et écrire : déchiffrer et rechiffrer
    # (plusieurs Mo) se fait sans lui, pour ne jamais bloquer le reste du serveur. Si
    # l'autre travail a écrit entre-temps, on recommence avec sa version.
    for _ in range(5):
        with _verrou:
            r = cnx().execute("SELECT extension FROM outlook WHERE utilisateur_id = ?", (uid,)).fetchone()
        if not r:
            return
        lu = r[0] or ""
        try:
            actuelle = json.loads(coffre.ouvrir(lu) or "{}") if lu else {}
        except ValueError:
            actuelle = {}
        fusion = {k: v for k, v in actuelle.items() if not garder(k)}
        fusion.update({k: v for k, v in nouvelle.items() if garder(k)})
        ferme = coffre.fermer(json.dumps(fusion))
        with _verrou:
            if cnx().execute("UPDATE outlook SET extension = ? WHERE utilisateur_id = ? AND COALESCE(extension, '') = ?", (ferme, uid, lu)).rowcount:
                return
