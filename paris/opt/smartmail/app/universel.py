"""Connexion universelle (16/11) : n'importe quelle messagerie d'école qui n'est ni Outlook ni Gmail
(Zimbra, Roundcube, SOGo, Exchange sur place…), par les protocoles standard de toutes les messageries :
IMAP (vérifier le mot de passe) et SMTP (envoyer). Aucun navigateur : léger pour le serveur.

- Les serveurs de l'école sont trouvés tout seuls : configuration automatique publiée par l'école
  (Thunderbird), puis les noms habituels (imap., mail., smtp.…) du domaine et de son domaine parent.
- Le mot de passe est gardé CHIFFRÉ (app.coffre), comme les sessions Outlook et Gmail : SMTP en a
  besoin à chaque envoi. L'ambassadeur en est prévenu à la connexion.
- L'envoi part du serveur SMTP de l'école, en Cci, au rythme réglé (packs, attente, plage horaire,
  plafond sur 24 h glissantes), avec les mêmes réservations que les autres messageries : jamais deux
  fois le même élève, jamais un élève déjà servi par un autre ambassadeur.
- L'annuaire : celui de Zimbra (le webmail le plus courant des universités françaises), interrogé
  avec les identifiants de l'étudiant. Sans Zimbra, l'annuaire reste à trouver (rien n'est extrait).
"""

import asyncio
import imaplib
import json
import os
import smtplib
import socket
import ssl
import time
from concurrent.futures import ThreadPoolExecutor
import urllib.request
import xml.etree.ElementTree as ET
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from starlette.concurrency import run_in_threadpool

from . import base, coffre

DELAI = 12  # secondes, pour chaque essai réseau
NOM = "universel"
RECHERCHE_MAX = 25  # secondes : l'ambassadeur a toujours une réponse en moins de 30 s


# ------------------------------------------------------------------ relais en France (16/11)
# Certaines universités (Montpellier) refusent les connexions SMTP venues de l'étranger : le serveur
# Smart Mail est au Canada. SMTP et IMAP passent alors par notre serveur de Paris (Hostinger), par
# un tunnel SSH chiffré ouvert sur l'hôte (service smartmail-relais, SOCKS5, ports de messagerie
# seulement). Adresse du relais : variable SMARTMAIL_RELAIS_ECOLES ou fichier /data/relais_socks
# (« 172.18.0.1:1080 »). Relais injoignable : connexion directe.
def _relais():
    v = os.environ.get("SMARTMAIL_RELAIS_ECOLES", "").strip()
    if not v:
        try:
            with open("/data/relais_socks") as f:
                v = f.read().strip()
        except OSError:
            v = ""
    if ":" not in v:
        return None
    h, p = v.rsplit(":", 1)
    return h, int(p)


def _recevoir(s, n):
    data = b""
    while len(data) < n:
        bloc = s.recv(n - len(data))
        if not bloc:
            raise OSError("relais : connexion fermée")
        data += bloc
    return data


def _par_relais(relais, hote, port, delai):
    s = socket.create_connection(relais, timeout=delai)
    try:
        s.sendall(b"\x05\x01\x00")
        if _recevoir(s, 2) != b"\x05\x00":
            raise OSError("relais : refus")
        nom = hote.encode("idna")
        s.sendall(b"\x05\x01\x00\x03" + bytes([len(nom)]) + nom + int(port).to_bytes(2, "big"))
        r = _recevoir(s, 4)
        if r[1] != 0:
            raise OSError(f"relais : {hote}:{port} injoignable (code {r[1]})")
        _recevoir(s, {1: 4, 4: 16}.get(r[3], 0) or _recevoir(s, 1)[0])
        _recevoir(s, 2)
        s.settimeout(delai)
        return s
    except BaseException:
        s.close()
        raise


def _connecter(hote, port, delai=DELAI):
    """Une connexion TCP vers le serveur de l'école : par le relais en France s'il existe, sinon en direct."""
    relais = _relais()
    if relais:
        try:
            return _par_relais(relais, hote, port, delai)
        except OSError:
            pass
    return socket.create_connection((hote, port), timeout=delai)


class _SMTP(smtplib.SMTP):
    def _get_socket(self, host, port, timeout):
        return _connecter(host, port, timeout)


class _SMTP_SSL(smtplib.SMTP_SSL):
    def _get_socket(self, host, port, timeout):
        return self.context.wrap_socket(_connecter(host, port, timeout), server_hostname=self._host)


class _IMAP4(imaplib.IMAP4):
    def _create_socket(self, timeout):
        return _connecter(self.host, self.port, timeout)


class _IMAP4_SSL(imaplib.IMAP4_SSL):
    def _create_socket(self, timeout):
        return self.ssl_context.wrap_socket(_connecter(self.host, self.port, timeout), server_hostname=self.host)


class Echec(Exception):
    """Connexion impossible : le message est montré tel quel à l'ambassadeur."""


# ------------------------------------------------------------------ trouver les serveurs de l'école
def _domaines(adresse):
    """etu.umontpellier.fr → [etu.umontpellier.fr, umontpellier.fr] (jamais un simple « .fr »)."""
    d = adresse.rsplit("@", 1)[-1].lower().strip(".")
    parts = d.split(".")
    out = [".".join(parts[i:]) for i in range(len(parts) - 1)]
    return [x for x in out if x.count(".") >= 1 and len(x.split(".")[0]) > 1] or [d]


def _resout(hote):
    try:
        socket.getaddrinfo(hote, None)
        return True
    except OSError:
        return False


def _lire_url(url, delai=4):
    req = urllib.request.Request(url, headers={"User-Agent": "SmartMail/1.0"})
    with urllib.request.urlopen(req, timeout=delai) as r:  # noqa: S310 (adresses construites ici)
        return r.read(200000)


def _autoconfig(adresse):
    """Configuration publiée par l'école ou connue de Thunderbird : [(type, hote, port, mode, identifiant)]."""
    out = []
    urls = [u for d in _domaines(adresse)[:2] for u in (
        f"https://autoconfig.{d}/mail/config-v1.1.xml?emailaddress={adresse}",
        f"https://{d}/.well-known/autoconfig/mail/config-v1.1.xml?emailaddress={adresse}",
        f"https://autoconfig.thunderbird.net/v1.1/{d}")]

    def lire(url):
        try:
            return ET.fromstring(_lire_url(url))
        except Exception:
            return None
    with ThreadPoolExecutor(max_workers=6) as ex:
        documents = list(ex.map(lire, urls))  # en parallèle : jamais plus de quelques secondes
    for x in documents:
        if x is None:
            continue
        for s in x.iter():
            if s.tag not in ("incomingServer", "outgoingServer"):
                continue
            ty = (s.get("type") or "").lower()
            if ty not in ("imap", "smtp"):
                continue
            hote = (s.findtext("hostname") or "").strip()
            port = int((s.findtext("port") or "0").strip() or 0)
            sock = (s.findtext("socketType") or "").upper()
            ident = (s.findtext("username") or "").strip()
            if hote and port:
                out.append((ty, hote, port, "ssl" if sock == "SSL" else "starttls", ident))
        if out:
            return out
    return out


# Serveurs connus d'écoles (16/11). Dès qu'une école est ici, Smart Mail NE SONDE PLUS : il se
# connecte directement au bon serveur, une seule fois. C'est ce qui évite les rafales de connexions
# qui déclenchent la protection anti-abus de certaines universités (Montpellier a banni notre IP
# après nos sondages). Une école découverte par sondage est ajoutée ici automatiquement (base),
# pour ne la sonder qu'une fois dans sa vie.
CONFIG_ECOLES = {
    "etu.umontpellier.fr": {"smtp": {"hote": "smtp.etu.umontpellier.fr", "port": 465, "mode": "ssl"},
                            "imap": {"hote": "imap.etu.umontpellier.fr", "port": 993, "mode": "ssl"}, "zimbra": None},
    "umontpellier.fr": {"smtp": {"hote": "smtp.umontpellier.fr", "port": 587, "mode": "starttls"},
                        "imap": {"hote": "imap.umontpellier.fr", "port": 993, "mode": "ssl"}, "zimbra": None},
}


def _config_connue(adresse):
    """La configuration déjà connue de l'école (constante, ou apprise et gardée en base), ou None."""
    for d in _domaines(adresse):
        if d in CONFIG_ECOLES:
            return dict(CONFIG_ECOLES[d])
    for d in _domaines(adresse):
        apprise = base.config_ecole_lire(d) if hasattr(base, "config_ecole_lire") else None
        if apprise:
            return apprise
    return None


def _retenir_ecole(adresse, cfg):
    """Garde les serveurs trouvés pour ce domaine : la prochaine école du même domaine ne sonde plus."""
    d = adresse.rsplit("@", 1)[-1].lower()
    if d in CONFIG_ECOLES or not hasattr(base, "config_ecole_ecrire"):
        return
    base.config_ecole_ecrire(d, {k: cfg[k] for k in ("smtp", "imap", "zimbra") if k in cfg})


def _candidats(adresse):
    """Serveurs à essayer, les plus probables d'abord : {"imap": [(hote, port, mode)], "smtp": [...]}."""
    imap, smtp = [], []
    for ty, hote, port, mode, _ in _autoconfig(adresse):
        (imap if ty == "imap" else smtp).append((hote, port, mode))
    for d in _domaines(adresse):
        for h in (f"imap.{d}", f"mail.{d}", f"imaps.{d}", f"webmail.{d}"):
            imap += [(h, 993, "ssl"), (h, 143, "starttls")]
        for h in (f"smtp.{d}", f"mail.{d}", f"smtps.{d}", f"relay.{d}"):
            smtp += [(h, 587, "starttls"), (h, 465, "ssl")]
    hotes = sorted({c[0] for c in imap + smtp})
    with ThreadPoolExecutor(max_workers=16) as ex:
        resolus = {h for h, ok in zip(hotes, ex.map(_resout, hotes)) if ok}
    vus, propres = set(), {"imap": [], "smtp": []}
    for cle, liste in (("imap", imap), ("smtp", smtp)):
        for c in liste:
            if c not in vus and c[0] in resolus:
                vus.add(c)
                propres[cle].append(c)
    return propres


def _ouvert(hote, port):
    try:
        _connecter(hote, port, 5).close()
        return True
    except OSError:
        return False


def _ouverts(liste):
    """Les serveurs joignables de la liste, dans le même ordre, testés en parallèle."""
    if not liste:
        return []
    with ThreadPoolExecutor(max_workers=min(16, len(liste))) as ex:
        ok = list(ex.map(lambda c: _ouvert(c[0], c[1]), liste))
    return [c for c, o in zip(liste, ok) if o]


def _identifiants(adresse, identifiant=None):
    if identifiant:
        return [identifiant.strip()]
    return [adresse, adresse.split("@", 1)[0]]


# ------------------------------------------------------------------ IMAP et SMTP
def _imap_connexion(hote, port, mode, ident, mdp):
    ctx = ssl.create_default_context()
    if mode == "ssl":
        m = _IMAP4_SSL(hote, port, ssl_context=ctx, timeout=DELAI)
    else:
        m = _IMAP4(hote, port, timeout=DELAI)
        m.starttls(ssl_context=ctx)
    m.login(ident, mdp)
    return m


def _smtp_connexion(hote, port, mode, ident, mdp):
    ctx = ssl.create_default_context()
    if mode == "ssl":
        s = _SMTP_SSL(hote, port, timeout=DELAI * 3, context=ctx)
    else:
        s = _SMTP(hote, port, timeout=DELAI * 3)
        s.ehlo()
        s.starttls(context=ctx)
        s.ehlo()
    s.login(ident, mdp)
    return s


def detecter(adresse, mdp, identifiant=None):
    """Trouve les serveurs de l'école et l'identifiant qui marche. Rend la configuration ;
    lève Echec avec un message clair sinon. SMTP est indispensable (c'est lui qui envoie)."""
    adresse = adresse.strip().lower()
    fin = time.monotonic() + RECHERCHE_MAX
    idents = _identifiants(adresse, identifiant)
    cfg, refus, joignable = {"adresse": adresse}, False, False

    # École déjà connue : on ne sonde pas (une seule connexion au bon serveur), ce qui évite la
    # rafale de connexions qui fait bannir notre IP par les universités protégées.
    connue = _config_connue(adresse)
    if connue and connue.get("smtp"):
        s_cfg = connue["smtp"]
        for ident in idents:
            try:
                _smtp_connexion(s_cfg["hote"], s_cfg["port"], s_cfg["mode"], ident, mdp).quit()
                cfg.update(smtp=s_cfg, identifiant=ident, imap=connue.get("imap"), zimbra=connue.get("zimbra"))
                return {k: v for k, v in cfg.items() if v is not None or k == "zimbra"}
            except smtplib.SMTPAuthenticationError:
                refus = True
            except (smtplib.SMTPException, OSError, ssl.SSLError) as x:
                raise Echec("Le serveur de votre école n'a pas répondu (il nous bloque peut-être temporairement). "
                            "Réessayez dans quelques minutes.") from x
        raise Echec("Adresse ou mot de passe refusé par la messagerie de votre école. Vérifiez-les ; si votre école "
                    "utilise un identifiant différent de l'adresse (numéro étudiant, prénom.nom…), indiquez-le dans "
                    "« Identifiant ».")

    cands = _candidats(adresse)
    smtp_ouverts = _ouverts(cands["smtp"])
    for hote, port, mode in smtp_ouverts:
        if time.monotonic() > fin:
            break
        joignable = True
        for ident in idents:
            try:
                s = _smtp_connexion(hote, port, mode, ident, mdp)
                s.quit()
                cfg["smtp"] = {"hote": hote, "port": port, "mode": mode}
                cfg["identifiant"] = ident
                break
            except smtplib.SMTPAuthenticationError:
                refus = True
            except (smtplib.SMTPException, OSError, ssl.SSLError):
                break  # ce serveur ne convient pas : le suivant
        if "smtp" in cfg:
            break
    if "smtp" not in cfg:
        if refus:
            raise Echec("Adresse ou mot de passe refusé par la messagerie de votre école. Vérifiez-les ; si votre école "
                        "utilise un identifiant différent de l'adresse (numéro étudiant, prénom.nom…), indiquez-le dans "
                        "« Identifiant ».")
        if joignable:
            raise Echec("La messagerie de votre école n'accepte pas l'envoi depuis l'extérieur avec ce compte. "
                        "Connectez-vous plutôt avec Outlook ou Gmail si votre école les utilise.")
        raise Echec("Smart Mail n'a pas trouvé le serveur d'envoi de votre école. Vérifiez l'adresse, ou "
                    "connectez-vous avec Outlook ou Gmail.")

    # IMAP : utile (vérifier la session sans rien envoyer), pas indispensable.
    for hote, port, mode in _ouverts(cands["imap"])[:3]:
        try:
            m = _imap_connexion(hote, port, mode, cfg["identifiant"], mdp)
            m.logout()
            cfg["imap"] = {"hote": hote, "port": port, "mode": mode}
            break
        except (imaplib.IMAP4.error, OSError, ssl.SSLError):
            continue
    cfg["zimbra"] = _zimbra_trouver(adresse, cfg, mdp, fin=max(fin, time.monotonic() + 10))
    _retenir_ecole(adresse, cfg)  # trouvée par sondage : gardée, on ne sondera plus ce domaine
    return cfg


# ------------------------------------------------------------------ Zimbra (annuaire)
def _soap(url, corps, jeton=None, delai=20):
    entete = {"context": {"_jsns": "urn:zimbra"}}
    if jeton:
        entete["context"]["authToken"] = {"_content": jeton}
    donnees = json.dumps({"Header": entete, "Body": corps}).encode()
    req = urllib.request.Request(url, data=donnees, headers={"Content-Type": "application/json", "User-Agent": "SmartMail/1.0"})
    with urllib.request.urlopen(req, timeout=delai) as r:  # noqa: S310
        return json.loads(r.read())


def _zimbra_jeton(url, compte, mdp, delai=20):
    r = _soap(url, {"AuthRequest": {"_jsns": "urn:zimbraAccount", "account": {"by": "name", "_content": compte},
                                    "password": {"_content": mdp}}}, delai=delai)
    a = (r.get("Body") or {}).get("AuthResponse") or {}
    jeton = a.get("authToken")
    if isinstance(jeton, list):
        jeton = (jeton[0] or {}).get("_content")
    return jeton


def _zimbra_trouver(adresse, cfg, mdp, fin=None):
    """L'adresse SOAP du Zimbra de l'école, si elle en a un et que ces identifiants y entrent."""
    hotes = []
    for k in ("imap", "smtp"):
        if cfg.get(k):
            hotes.append(cfg[k]["hote"])
    for d in _domaines(adresse):
        hotes += [f"mail.{d}", f"webmail.{d}", f"zimbra.{d}", f"messagerie.{d}"]
    hotes.append("partage.renater.fr")  # RENATER Partage : le Zimbra de nombreuses universités
    vus, fin = set(), fin or time.monotonic() + 15  # jamais une longue attente pour l'ambassadeur
    for h in hotes:
        if h in vus or time.monotonic() > fin or not _resout(h):
            continue
        vus.add(h)
        url = f"https://{h}/service/soap"
        for compte in (adresse, cfg.get("identifiant")):
            if not compte:
                continue
            try:
                if _zimbra_jeton(url, compte, mdp, delai=8):
                    return {"url": url, "compte": compte}
            except Exception:
                break  # pas de Zimbra ici (ou injoignable) : l'hôte suivant
    return None


def zimbra_chercher(z, mdp, nom, jeton=None):
    """Recherche dans l'annuaire Zimbra. Rend (personnes [{adresse, nom}], plus, jeton)."""
    jeton = jeton or _zimbra_jeton(z["url"], z["compte"], mdp)
    r = _soap(z["url"], {"SearchGalRequest": {"_jsns": "urn:zimbraAccount", "name": nom, "limit": 1000, "type": "account"}}, jeton)
    rep = (r.get("Body") or {}).get("SearchGalResponse") or {}
    personnes = []
    for cn in rep.get("cn") or []:
        attrs = cn.get("_attrs") or {}
        email = attrs.get("email") or ""
        if isinstance(email, list):
            email = email[0] if email else ""
        if email and "@" in email:
            nomc = attrs.get("fullName") or " ".join(x for x in (attrs.get("firstName"), attrs.get("lastName")) if x) or ""
            personnes.append({"adresse": email.lower(), "nom": nomc})
    return personnes, bool(rep.get("more")), jeton


# ------------------------------------------------------------------ session gardée
def etat(uid):
    """La configuration gardée (avec le mot de passe), ou None."""
    o = base.outlook_lire(uid)
    if not o or (o.get("messagerie") or "") != NOM:
        return None
    try:
        e = json.loads(coffre.ouvrir(o["etat"]) or "null")
    except ValueError:
        return None
    return e if isinstance(e, dict) and e.get("universel") else None


_essais = {}


def trop_d_essais(ip):
    maintenant = time.monotonic()
    liste = [t for t in _essais.get(ip, []) if maintenant - t < 900]
    liste.append(maintenant)
    _essais[ip] = liste
    return len(liste) > 8


async def connecter(adresse, mdp, identifiant, appareil):
    """Vérifie les identifiants, puis crée la session Smart Mail (comme Outlook et Gmail)."""
    from . import navigateur
    adresse = adresse.strip().lower()
    if "@" not in adresse:
        raise Echec("Indiquez votre adresse e-mail complète.")
    cfg = await run_in_threadpool(detecter, adresse, mdp, identifiant or None)
    etat_ = {"universel": cfg, "mdp": mdp}
    try:
        r = navigateur.terminer(adresse, appareil, etat_, NOM)
    except navigateur._Echec as e:
        raise Echec(e.detail or "Connexion refusée.")
    uid = (base.utilisateur_par_email(r["email"]) or {}).get("id")
    if uid:
        annuaire = "annuaire Zimbra trouvé" if cfg.get("zimbra") else "pas d'annuaire Zimbra (l'annuaire de l'école reste à trouver)"
        base.journal_noter(uid, "session", f"Connexion universelle réussie : envoi par {cfg['smtp']['hote']}, {annuaire}.", "succes")
    return r


async def verifier_compte(uid):
    """La messagerie accepte-t-elle toujours ce mot de passe ? Non : la session est oubliée (l'ambassadeur
    se reconnecte). Réseau en panne : la session est gardée."""
    e = etat(uid)
    if not e:
        return False
    cfg, mdp = e["universel"], e.get("mdp") or ""

    def essai():
        if cfg.get("imap"):
            i = cfg["imap"]
            _imap_connexion(i["hote"], i["port"], i["mode"], cfg["identifiant"], mdp).logout()
        else:
            s = cfg["smtp"]
            _smtp_connexion(s["hote"], s["port"], s["mode"], cfg["identifiant"], mdp).quit()
    try:
        await run_in_threadpool(essai)
    except (smtplib.SMTPAuthenticationError, imaplib.IMAP4.error):
        if base.outlook_lire(uid):
            base.outlook_oublier(uid)
            base.journal_noter(uid, "session", "La messagerie de l'école refuse désormais le mot de passe (changé ?) : "
                                               "l'ambassadeur doit se reconnecter.", "critique")
        return False
    except Exception:
        return True  # serveur injoignable : on garde la session, nouvel essai plus tard
    base.outlook_rafraichir(uid, base.outlook_lire(uid)["etat"])  # vérifiée maintenant
    return True


# ------------------------------------------------------------------ envoyer
class Bloque(Exception):
    """La messagerie refuse d'envoyer (limite, soupçon de spam)."""


def _message(adresse, a, objet, texte, langue="fr"):
    from . import travaux
    corps = travaux.personnaliser(texte, langue=langue)
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = adresse, a, travaux.personnaliser(objet, langue=langue)
    m["Date"], m["Message-ID"] = formatdate(localtime=True), make_msgid(domain=adresse.split("@")[-1])
    m.set_content(corps)
    m.add_alternative(travaux.en_html(corps), subtype="html")
    return m


def envoyer_smtp(e, a, cci, objet, texte, langue="fr"):
    """Un mail à « a », avec « cci » en copie cachée. Rend les adresses refusées par le serveur."""
    cfg, mdp = e["universel"], e.get("mdp") or ""
    s_cfg = cfg["smtp"]
    msg = _message(cfg["adresse"], a, objet, texte, langue)
    s = _smtp_connexion(s_cfg["hote"], s_cfg["port"], s_cfg["mode"], cfg["identifiant"], mdp)
    try:
        refuses = s.send_message(msg, from_addr=cfg["adresse"], to_addrs=[a] + list(cci))
    except smtplib.SMTPRecipientsRefused as x:
        return set(k.lower() for k in x.recipients)
    except (smtplib.SMTPSenderRefused, smtplib.SMTPDataError) as x:
        if 500 <= int(getattr(x, "smtp_code", 0) or 0) < 600:
            raise Bloque(f"{x.smtp_code} {x.smtp_error!r}"[:200])
        raise
    finally:
        try:
            s.quit()
        except Exception:
            pass
    return set(k.lower() for k in (refuses or {}))


async def envoyer_simple(uid, a, objet, texte):
    """Un mail à une seule personne (relances). Vrai s'il est parti."""
    e = etat(uid)
    if not e:
        return False
    try:
        refuses = await run_in_threadpool(envoyer_smtp, e, a, [], objet, texte, "fr")
    except Exception as x:
        print(f"[universel] compte {uid} : relance impossible ({type(x).__name__})", flush=True)
        return False
    return a.lower() not in refuses


async def envoyer_travail(t, params):
    """L'envoi d'un travail « envoi » ou « test » par SMTP, au rythme réglé (même contrat que l'envoi
    par Outlook/Gmail : statuts, compteurs, packs, plage horaire, pause, fin)."""
    from . import travaux
    uid, type_ = t.uid, t.type
    test = type_ == "test"
    p = params.get("parametres") or {}
    objet, texte, langue = params.get("objet") or "", params.get("texte") or "", params.get("langue") or "fr"
    cumul = params.setdefault("cumul_univ", {"envoyes": 0, "echecs": 0})
    journal24 = params.setdefault("univ_24h", [])  # [[horodatage, destinataires]] : plafond sur 24 h glissantes
    e = etat(uid)
    if not e:
        raise travaux.ErreurTravail("Connexion universelle introuvable : reconnectez-vous.")
    moi = e["universel"]["adresse"]

    def prog(**extra):
        reste = base.destinataires_compter(uid, "a_envoyer")
        c = {"envoyes": cumul["envoyes"], "a_verifier": 0, "deja": 0, "echecs": cumul["echecs"],
             "total": cumul["envoyes"] + cumul["echecs"] + reste, "curseur": cumul["envoyes"] + cumul["echecs"]}
        c.update(extra)
        return c

    if test:
        await run_in_threadpool(envoyer_smtp, e, moi, [], objet, texte, langue)
        travaux._maj(uid, type_, "fini", params, {"envoyes": 1, "total": 1, "curseur": 1}, "Message test envoyé à votre adresse.")
        return

    pack = int(p.get("pack") or 0)
    dpm = travaux.destinataires_par_mail(p)
    attente = int(p.get("attente") or 30) * travaux.MINUTE
    ecart_mails = 30 if pack else 3600.0 / max(1, int(p.get("packs_heure", 35)))
    max_jour = int(p.get("max_jour") or 400)
    dans_pack = int(params.get("univ_dans_pack") or 0)
    erreurs = 0
    travaux._maj(uid, type_, "en_cours", params, prog(), "Envoi en cours (connexion universelle)…")
    while not t.arret.is_set():
        maintenant = time.time()
        journal24[:] = [x for x in journal24 if maintenant - x[0] < 86400]
        restant24 = max_jour - sum(x[1] for x in journal24)
        attendre, message = 0.0, ""
        if not travaux._dans_la_plage(p):
            attendre, message = 60, "Hors de la plage horaire : reprise à " + str(p.get("heure_debut", 8)) + " h."
        elif float(params.get("reprise_a") or 0) > maintenant:
            attendre = min(60, float(params["reprise_a"]) - maintenant)
            message = f"Pack terminé. Prochain pack de {pack} mails à {travaux._heure(params['reprise_a'])}."
        elif restant24 <= 0:
            libre = min(x[0] for x in journal24) + 86400
            attendre, message = min(300, libre - maintenant), f"Limite de {max_jour} par 24 h atteinte : reprise à {travaux._heure(libre)}."
        if attendre > 0:
            travaux._maj(uid, type_, "en_cours", params, prog(), message)
            try:
                await asyncio.wait_for(t.arret.wait(), timeout=attendre)
            except asyncio.TimeoutError:
                pass
            continue

        lot = await run_in_threadpool(travaux._choisir_eleves, uid, min(dpm, restant24))
        if not lot:
            if base.destinataires_compter(uid, "a_envoyer") == 0:
                travaux._maj(uid, type_, "fini", params, prog(), f"Envoi terminé : {cumul['envoyes']} élèves ont reçu le message.")
                return
            await asyncio.sleep(30)  # tous pris par un autre ambassadeur juste maintenant : on réessaie
            continue
        base.destinataires_statuer(uid, {a: "envoi" for a in lot})
        travaux._maj(uid, type_, "en_cours", params, prog(), f"Envoi d'un mail à {len(lot)} élèves (Cci)…")
        try:
            refuses = await run_in_threadpool(envoyer_smtp, e, moi, lot, objet, texte, langue)
            erreurs = 0
        except smtplib.SMTPAuthenticationError:
            base.destinataires_statuer(uid, {a: "" for a in lot})
            base.outlook_oublier(uid)
            base.journal_noter(uid, "session", "La messagerie de l'école refuse le mot de passe : l'ambassadeur doit se reconnecter.", "critique")
            travaux._maj(uid, type_, "attente", params, prog(), "En attente de la reconnexion de l'ambassadeur : l'envoi partira "
                                                               "tout seul dès qu'il se sera reconnecté.")
            while not base.outlook_lire(uid) and not t.arret.is_set():
                try:
                    await asyncio.wait_for(t.arret.wait(), timeout=60)
                except asyncio.TimeoutError:
                    pass
            e = etat(uid) or e
            continue
        except Bloque as x:
            base.destinataires_statuer(uid, {a: "" for a in lot})
            travaux._maj(uid, type_, "pause", params, prog(blocage=True),
                         "Envoi mis en pause : la messagerie de l'école refuse d'envoyer (limite ou soupçon de spam). "
                         f"Réponse du serveur : {x}. Attendez 24 h avant de reprendre.")
            base.journal_noter(uid, "envoi", f"Connexion universelle : envoi refusé par le serveur de l'école ({x}).", "critique")
            return
        except Exception as x:
            base.destinataires_statuer(uid, {a: "" for a in lot})
            erreurs += 1
            print(f"[universel] compte {uid} : envoi impossible ({type(x).__name__}: {str(x)[:160]})", flush=True)
            if erreurs > 6:
                raise travaux.ErreurTravail("Le serveur d'envoi de l'école ne répond plus. Rien n'est envoyé deux fois : relancez plus tard.")
            travaux._maj(uid, type_, "en_cours", params, prog(), "Serveur d'envoi de l'école injoignable : nouvel essai dans 10 min.")
            try:
                await asyncio.wait_for(t.arret.wait(), timeout=600)
            except asyncio.TimeoutError:
                pass
            continue
        ok = [a for a in lot if a.lower() not in refuses]
        base.destinataires_statuer(uid, {**{a: "envoye" for a in ok}, **{a: "echec" for a in lot if a.lower() in refuses}})
        if ok:
            base.marquer_recus(uid, ok)
        cumul["envoyes"] += len(ok)
        cumul["echecs"] += len(lot) - len(ok)
        journal24.append([time.time(), len(lot)])
        dans_pack += 1
        if pack and dans_pack >= pack:
            dans_pack = 0
            params["reprise_a"] = time.time() + attente
        params["univ_dans_pack"] = dans_pack
        travaux._maj(uid, type_, "en_cours", params, prog(), f"{cumul['envoyes']} élèves ont reçu le message.")
        if not params.get("reprise_a") or float(params["reprise_a"]) <= time.time():
            try:
                await asyncio.wait_for(t.arret.wait(), timeout=ecart_mails)
            except asyncio.TimeoutError:
                pass
    travaux._maj(uid, type_, "pause", params, prog(), "Envoi en pause.")


# ------------------------------------------------------------------ annuaire
_LETTRES = "abcdefghijklmnopqrstuvwxyz"


async def regrouper(t, params):
    """Extraction de l'annuaire Zimbra de l'école, par préfixes de nom (aa, ab… puis aaa… quand une
    recherche est pleine). Les contacts vont dans « extraits » ; le pilote lance ensuite le tri habituel."""
    from . import travaux
    uid = t.uid
    e = etat(uid)
    prog = {"objectif": int(params.get("objectif") or 0), "trouves": 0, "ecartes": 0, "releves": 0, "deja_contactes": 0,
            "extraits": base.extraits_compter(uid)}
    z = (e or {}).get("universel", {}).get("zimbra")
    if not z:
        travaux._maj(uid, "annuaire", "fini", params, prog, "Annuaire de l'école introuvable avec la connexion universelle "
                                                           "(pas de Zimbra) : aucun contact extrait.")
        base.journal_noter(uid, "annuaire", "Connexion universelle : l'école n'a pas d'annuaire Zimbra accessible.", "attention")
        return
    mdp = e.get("mdp") or ""
    fait = set(params.get("univ_prefixes_faits") or [])
    a_faire = [x + y for x in _LETTRES for y in _LETTRES]
    jeton = None
    travaux._maj(uid, "annuaire", "en_cours", params, prog, "Extraction de l'annuaire de l'école…")
    while a_faire and not t.arret.is_set():
        prefixe = a_faire.pop(0)
        if prefixe in fait:
            continue
        try:
            personnes, plus, jeton = await run_in_threadpool(zimbra_chercher, z, mdp, prefixe, jeton)
        except Exception as x:
            jeton = None
            print(f"[universel] compte {uid} : annuaire « {prefixe} » ({type(x).__name__})", flush=True)
            await asyncio.sleep(5)
            continue
        if plus and len(prefixe) < 5:
            a_faire[0:0] = [prefixe + c for c in _LETTRES]  # recherche pleine : on affine
        if personnes:
            prog["extraits"] = base.extraits_ajouter(uid, personnes)
        prog["releves"] += len(personnes)
        fait.add(prefixe)
        if len(fait) % 25 == 0:
            params["univ_prefixes_faits"] = sorted(fait)
        travaux._maj(uid, "annuaire", "en_cours", params, prog, f"Extraction de l'annuaire : {prog['extraits']} contacts…")
        await asyncio.sleep(0.3)
    params["univ_prefixes_faits"] = sorted(fait)
    if t.arret.is_set():
        travaux._maj(uid, "annuaire", "pause", params, prog, f"Extraction en pause : {prog['extraits']} contacts extraits.")
        return
    travaux._maj(uid, "annuaire", "fini", params, prog, f"Annuaire extrait : {prog['extraits']} contacts.")

