"""La « logique » d'une école, apprise par Claude sur un petit échantillon.

1. On calcule le FORMAT de chaque adresse à partir du nom (prenom.nom, p.nom,
   numéro…), de façon déterministe.
2. Claude regarde un échantillon d'environ 30 personnes (adresse, format, nom,
   intitulé) et en déduit, par domaine, quels formats sont ceux des étudiants et
   lesquels ceux du personnel, plus les mots d'intitulé qui trahissent l'un ou
   l'autre.
3. Le serveur applique ensuite cette logique lui-même à tous les autres contacts :
   gratuit et instantané. Ce qui ne colle pas à la logique part chez Claude.
"""

import json
import re
import unicodedata

import anthropic
from pydantic import BaseModel, Field

from . import config

FORMATS = ["prenom.nom", "nom.prenom", "p.nom", "prenomnom", "pnom", "prenom", "nom", "numero", "autre"]


def sans_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn").lower()


TITRES = {"dr", "dr.", "pr", "pr.", "prof", "prof.", "mme", "mr", "m.", "mlle", "monsieur", "madame", "mrs", "ms", "miss", "sir"}


def _lettres(s):
    return re.sub(r"[^a-z]", "", sans_accents(s))


def _prenom_nom(nom):
    """« Anne-Sophie Le Gall » → ("annesophie", "legall") : le premier mot est le prénom
    (composé avec un tiret), tout le reste est le nom (composé avec espaces ou tirets)."""
    mots = [m for m in re.sub(r"\(.*?\)", " ", nom or "").split() if m.lower() not in TITRES]
    if len(mots) < 2:
        return None, None
    return _lettres(mots[0]), _lettres("".join(mots[1:]))


def format_adresse(adresse, nom=""):
    """Format de la partie locale, en s'aidant du nom quand il est connu."""
    locale = sans_accents(adresse.split("@", 1)[0])
    base = re.sub(r"\d+$", "", locale)  # « marie.durand2 » a le même format que « marie.durand »
    if re.fullmatch(r"[a-z]{0,2}\d{4,}", locale):
        return "numero"
    p, n = _prenom_nom(nom)
    if p and n:
        # Séparateur principal : le point (ou le soulignement) ; le tiret peut être interne à un nom composé.
        m = re.match(r"^([^._]+)[._](.+)$", base)
        if m:
            g, d = _lettres(m.group(1)), _lettres(m.group(2))
            if (g, d) == (p, n):
                return "prenom.nom"
            if (g, d) == (n, p):
                return "nom.prenom"
            if len(g) == 1 and g == p[0] and d == n:
                return "p.nom"
        plat = _lettres(base)
        if plat == p + n:
            return "prenom.nom" if "-" in base else "prenomnom"
        if plat == n + p:
            return "nom.prenom" if "-" in base else "autre"
        if plat == p[0] + n:
            return "pnom"
        if plat == p:
            return "prenom"
        if plat == n:
            return "nom"
    # Sans nom (ou nom qui ne colle pas) : on devine par la forme.
    if re.fullmatch(r"[a-z][._-][a-z-]{2,}", base):
        return "p.nom"
    if re.fullmatch(r"[a-z-]{2,}[._][a-z-]{2,}", base):
        return "prenom.nom"
    return "autre"


# ------------------------------------------------------------ la logique apprise
class RegleDomaine(BaseModel):
    domaine: str = Field(max_length=200)
    formats_etudiant: list[str] = Field(default_factory=list, max_length=len(FORMATS))
    formats_personnel: list[str] = Field(default_factory=list, max_length=len(FORMATS))


class Logique(BaseModel):
    domaines: list[RegleDomaine] = Field(default_factory=list, max_length=50)
    mots_etudiant: list[str] = Field(default_factory=list, max_length=40)
    mots_personnel: list[str] = Field(default_factory=list, max_length=40)
    resume: str = Field(default="", max_length=400)


def nettoyer(logique: Logique) -> Logique:
    """Formats inconnus retirés ; un format revendiqué des deux côtés n'est plus décisif."""
    for d in logique.domaines:
        d.domaine = d.domaine.lower().strip().lstrip("@")
        e = [f for f in d.formats_etudiant if f in FORMATS and f != "autre"]
        p = [f for f in d.formats_personnel if f in FORMATS and f != "autre"]
        commun = set(e) & set(p)
        d.formats_etudiant = [f for f in e if f not in commun]
        d.formats_personnel = [f for f in p if f not in commun]
    logique.mots_etudiant = [sans_accents(m).strip() for m in logique.mots_etudiant if len(m.strip()) >= 3][:40]
    logique.mots_personnel = [sans_accents(m).strip() for m in logique.mots_personnel if len(m.strip()) >= 3][:40]
    return logique


def appliquer(contact, logique: Logique):
    """(groupe, type, raison) si la logique tranche, sinon None (→ Claude)."""
    if not logique:
        return None
    titre = " " + sans_accents((contact.get("intitule") or "") + " " + (contact.get("nom") or "")) + " "
    if any(re.search(r"\b" + re.escape(m) + r"\b", titre) for m in logique.mots_personnel):
        return ("hors", "personnel", "intitulé du personnel (logique de l'école)")
    if any(re.search(r"\b" + re.escape(m) + r"\b", titre) for m in logique.mots_etudiant):
        return ("etudiant", "etudiant", "intitulé étudiant (logique de l'école)")
    domaine = contact["adresse"].split("@", 1)[1]
    regle = next((d for d in logique.domaines if d.domaine == domaine), None)
    if not regle:
        return None
    f = format_adresse(contact["adresse"], contact.get("nom") or "")
    if f in regle.formats_etudiant:
        return ("etudiant", "etudiant", f"format {f} des étudiants de {domaine}")
    if f in regle.formats_personnel:
        return ("hors", "personnel", f"format {f} du personnel de {domaine}")
    return None


# ------------------------------------------------------------ apprentissage
SYSTEME = """Tu observes un ÉCHANTILLON de l'annuaire d'une école ou d'une université, pour en déduire sa LOGIQUE :
comment distinguer les étudiants du personnel (professeurs, administration).

Pour chaque personne, on te donne : adresse | format de l'adresse (calculé) | nom | intitulé (poste, département, programme).

Déduis :
- par domaine d'adresse, les formats utilisés par les ÉTUDIANTS et ceux utilisés par le PERSONNEL, parmi :
  """ + ", ".join(FORMATS[:-1]) + """ ;
- des mots d'intitulé qui désignent les étudiants (ex. « étudiant », « PGE », « bachelor », une promotion) et ceux qui désignent le personnel
  (ex. « professeur », « assistant », « responsable ») — uniquement des mots réellement présents ou très probables dans cet annuaire ;
- un résumé d'une phrase, en français, que l'utilisateur pourra lire (ex. « Étudiants en prenom.nom@ieseg.fr, personnel en p.nom@ieseg.fr »).

Sois prudent : n'attribue un format à un groupe que si l'échantillon le montre clairement (au moins deux personnes, aucune contradiction).
Si un format sert aux deux groupes, ne le mets nulle part. Mieux vaut une logique incomplète qu'une logique fausse."""

# « Garder seulement les étudiants » : Claude voit les proportions de TOUT l'annuaire extrait
# (combien de contacts par domaine et par format) et un échantillon de chaque groupe. Il en
# déduit la logique bien mieux que sur les 30 premiers contacts lus.
SYSTEME_GLOBAL = """Tu observes TOUT l'annuaire extrait d'une école ou d'une université (statistiques et échantillon), pour en déduire sa
LOGIQUE : comment distinguer les étudiants du personnel (professeurs, administration).

On te donne :
- les STATISTIQUES de tout l'annuaire : nombre de contacts par domaine, et répartition des formats d'adresse ;
- un ÉCHANTILLON de chaque groupe (domaine, format) : adresse | format de l'adresse (calculé) | nom | intitulé.

Déduis :
- par domaine d'adresse, les formats utilisés par les ÉTUDIANTS et ceux utilisés par le PERSONNEL, parmi :
  """ + ", ".join(FORMATS[:-1]) + """ ;
- des mots d'intitulé ou de nom qui désignent les étudiants et ceux qui désignent le personnel (titres Dr, Pr, Prof., fonctions) —
  uniquement des mots réellement présents ou très probables dans cet annuaire ;
- un résumé d'une phrase, en français, que l'utilisateur pourra lire (ex. « Étudiants en prenom.nom@mail.mcgill.ca, personnel en
  prenom.nom@mcgill.ca »).

Comment raisonner :
- Dans l'annuaire d'une école, les étudiants sont de loin le groupe le plus nombreux. Le domaine et le format les plus fréquents,
  sans titres ni intitulés de poste, sont en général ceux des étudiants.
- Un sous-domaine étudiant (mail., etu., etud., student., students.…) montre que le domaine principal de l'école est celui du
  personnel : mets alors les formats de ce domaine principal dans « formats_personnel ».
- Si tu connais la convention réelle de cette école (par exemple les étudiants de McGill sont sur mail.mcgill.ca), utilise-la.
- Un format présent dans les deux groupes d'un même domaine n'est décisif nulle part : ne le mets dans aucun des deux."""


def part_etudiants(logique, contacts):
    """Part des contacts que cette logique désigne comme étudiants (sans IA, sans coût)."""
    if not logique or not contacts:
        return 0.0
    n = sum(1 for c in contacts if (appliquer(c, logique) or ("",))[0] == "etudiant")
    return n / len(contacts)


VERIFICATION = ("Vérification : avec ta logique, seulement {part} des {n} contacts de l'annuaire seraient des étudiants. "
                "Dans l'annuaire d'une école, les étudiants sont presque toujours de loin les plus nombreux : revois ta logique. "
                "Ne la garde que si l'école a vraiment un domaine ou un sous-domaine réservé aux étudiants (comme mail.mcgill.ca) et "
                "que le reste de l'annuaire est réellement le personnel.")


def statistiques(contacts):
    """{domaine: {"total": n, "formats": {format: n}}}, les domaines les plus nombreux d'abord."""
    par_dom = {}
    for c in contacts:
        dom = c["adresse"].lower().rsplit("@", 1)[-1]
        d = par_dom.setdefault(dom, {"total": 0, "formats": {}})
        d["total"] += 1
        f = format_adresse(c["adresse"], c.get("nom") or "")
        d["formats"][f] = d["formats"].get(f, 0) + 1
    return dict(sorted(par_dom.items(), key=lambda kv: -kv[1]["total"]))


def echantillon_global(contacts, par_groupe=6, maximum=140, domaines=10):
    """Quelques personnes de chaque (domaine, format) qui compte : tout l'annuaire est représenté."""
    groupes = {}
    for c in contacts:
        cle = (c["adresse"].lower().rsplit("@", 1)[-1], format_adresse(c["adresse"], c.get("nom") or ""))
        groupes.setdefault(cle, []).append(c)
    top = set(list(statistiques(contacts))[:domaines])
    choix = []
    for (dom, _f), membres in sorted(groupes.items(), key=lambda kv: -len(kv[1])):
        if dom not in top:
            continue
        avec_nom = [c for c in membres if c.get("nom")] or membres
        pas = max(1, len(avec_nom) // par_groupe)  # étalés dans le groupe, pas seulement les premiers
        choix.extend(avec_nom[::pas][:par_groupe])
        if len(choix) >= maximum:
            break
    return choix[:maximum]


def message_global(contacts):
    stats = statistiques(contacts)
    total = max(1, len(contacts))
    lignes = [f"Statistiques de tout l'annuaire extrait ({len(contacts)} contacts) :"]
    for dom, d in list(stats.items())[:12]:
        formats = ", ".join(f"{f} {100 * n // d['total']} %" for f, n in sorted(d["formats"].items(), key=lambda kv: -kv[1])[:5])
        lignes.append(f"- {dom} : {d['total']} contacts ({100 * d['total'] // total} %) — formats : {formats}")
    lignes.append("")
    lignes.append(message_echantillon(echantillon_global(contacts)))
    return "\n".join(lignes)

SCHEMA = {
    "type": "object",
    "properties": {
        "domaines": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "domaine": {"type": "string"},
                "formats_etudiant": {"type": "array", "items": {"type": "string", "enum": FORMATS[:-1]}},
                "formats_personnel": {"type": "array", "items": {"type": "string", "enum": FORMATS[:-1]}},
            },
            "required": ["domaine", "formats_etudiant", "formats_personnel"],
            "additionalProperties": False,
        }},
        "mots_etudiant": {"type": "array", "items": {"type": "string"}},
        "mots_personnel": {"type": "array", "items": {"type": "string"}},
        "resume": {"type": "string"},
    },
    "required": ["domaines", "mots_etudiant", "mots_personnel", "resume"],
    "additionalProperties": False,
}


def message_echantillon(echantillon):
    lignes = ["Échantillon (adresse | format | nom | intitulé) :"]
    for c in echantillon:
        propre = lambda s: " ".join(str(s or "").replace("|", "/").split())[:120]
        lignes.append(f"{propre(c['adresse'])} | {format_adresse(c['adresse'], c.get('nom'))} | {propre(c.get('nom'))} | {propre(c.get('intitule'))}")
    return "\n".join(lignes)


class ApprentiClaude:
    def __init__(self, client=None):
        self.client = client or anthropic.Anthropic(max_retries=4, timeout=120.0)

    def apprendre(self, echantillon):
        """Rend (Logique, coût en $, erreur)."""
        try:
            r = self.client.beta.messages.create(
                model=config.MODELE,
                max_tokens=8000,
                system=SYSTEME,
                messages=[{"role": "user", "content": message_echantillon(echantillon)}],
                # Ici Claude doit vraiment raisonner sur l'échantillon : effort moyen.
                output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIStatusError as e:
            credit = "credit balance" in str(getattr(e, "message", "") or "").lower()
            return None, 0.0, "crédit Anthropic épuisé" if credit else f"erreur Anthropic {e.status_code}"
        except anthropic.APIConnectionError:
            return None, 0.0, "Anthropic injoignable"
        u = r.usage
        cout = config.cout(getattr(r, "model", config.MODELE), int(u.input_tokens or 0), int(u.output_tokens or 0))
        if r.stop_reason in ("refusal", "max_tokens"):
            return None, cout, "Claude n'a pas pu dégager de logique"
        try:
            texte = next(b.text for b in r.content if getattr(b, "type", "") == "text")
            return nettoyer(Logique.model_validate(json.loads(texte))), cout, ""
        except (StopIteration, ValueError, TypeError):
            return None, cout, "réponse de Claude illisible"

    def apprendre_global(self, contacts, remarque=""):
        """Logique apprise sur tout l'annuaire extrait. Rend (Logique, coût en $, erreur)."""
        try:
            r = self.client.beta.messages.create(
                model=config.MODELE,
                max_tokens=8000,
                system=SYSTEME_GLOBAL,
                messages=[{"role": "user", "content": message_global(contacts) + (f"\n\n{remarque}" if remarque else "")}],
                output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIStatusError as e:
            credit = "credit balance" in str(getattr(e, "message", "") or "").lower()
            return None, 0.0, "crédit Anthropic épuisé" if credit else f"erreur Anthropic {e.status_code}"
        except anthropic.APIConnectionError:
            return None, 0.0, "Anthropic injoignable"
        u = r.usage
        cout = config.cout(getattr(r, "model", config.MODELE), int(u.input_tokens or 0), int(u.output_tokens or 0))
        if r.stop_reason in ("refusal", "max_tokens"):
            return None, cout, "Claude n'a pas pu dégager de logique"
        try:
            texte = next(b.text for b in r.content if getattr(b, "type", "") == "text")
            return nettoyer(Logique.model_validate(json.loads(texte))), cout, ""
        except (StopIteration, ValueError, TypeError):
            return None, cout, "réponse de Claude illisible"


class FauxApprenti:
    """Simulation : déduit la logique des intitulés de l'échantillon, sans Claude."""
    MOTS_E = ["etudiant", "etudiante", "student", "pge", "bachelor", "promo", "programme"]
    MOTS_P = ["professeur", "professeure", "enseignant", "enseignante", "assistant", "assistante", "responsable", "directeur", "directrice", "charge", "chargee"]

    def apprendre(self, echantillon):
        if config.FAUX_LATENCE:
            import time
            time.sleep(config.FAUX_LATENCE)
        par_dom = {}
        for c in echantillon:
            dom = c["adresse"].lower().split("@", 1)[1]
            t = sans_accents((c.get("intitule") or "") + " " + (c.get("nom") or ""))
            f = format_adresse(c["adresse"], c.get("nom"))
            d = par_dom.setdefault(dom, {"e": {}, "p": {}})
            if any(m in t for m in self.MOTS_P):
                d["p"][f] = d["p"].get(f, 0) + 1
            elif any(m in t for m in self.MOTS_E):
                d["e"][f] = d["e"].get(f, 0) + 1
        domaines = [RegleDomaine(domaine=dom, formats_etudiant=[f for f, n in d["e"].items() if n >= 2],
                                 formats_personnel=[f for f, n in d["p"].items() if n >= 2]) for dom, d in par_dom.items()]
        lg = nettoyer(Logique(domaines=domaines, mots_etudiant=self.MOTS_E, mots_personnel=self.MOTS_P))
        parts = [f"étudiants en {'/'.join(d.formats_etudiant)}@{d.domaine}" for d in lg.domaines if d.formats_etudiant]
        lg.resume = (", ".join(parts)[:1].upper() + ", ".join(parts)[1:] + ".") if parts else "Aucun format dominant : chaque contact est analysé individuellement."
        return lg, 0.0, ""

    def apprendre_global(self, contacts, remarque=""):
        return self.apprendre(echantillon_global(contacts, par_groupe=20, maximum=400))


def apprenti():
    return FauxApprenti() if config.FAUX_CLAUDE else ApprentiClaude()
