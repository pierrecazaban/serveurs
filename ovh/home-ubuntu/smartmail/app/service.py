"""Le tri complet d'une liste de contacts : cache → règles → Claude, dans les
limites du quota de l'utilisateur et du budget mensuel global."""

from concurrent.futures import ThreadPoolExecutor
import threading

from . import base, config, logique as logique_mod, regles
from .ia import classeur as fabrique_classeur

# Une seule IA partagée (le client HTTP du SDK est réutilisable entre fils).
_classeur = None
_verrou_budget = threading.Lock()
# Plafond d'appels simultanés à Claude, TOUS utilisateurs confondus : évite de
# déclencher les limites de débit d'Anthropic quand 20 personnes trient en même temps.
_appels = threading.BoundedSemaphore(max(1, config.APPELS_MAX))


def classeur():
    global _classeur
    if _classeur is None:
        _classeur = fabrique_classeur()
    return _classeur


def definir_classeur(c):
    """Pour les tests : injecter un faux Claude."""
    global _classeur
    _classeur = c


def _normaliser(contacts):
    """Dédoublonne (adresse en minuscules) en gardant le premier nom/intitulé non vide."""
    vus, ordre = {}, []
    for c in contacts:
        a = str(c.get("adresse") or "").strip().lower()
        if not a:
            continue
        if a not in vus:
            vus[a] = {"adresse": a, "nom": str(c.get("nom") or "").strip()[:200], "intitule": str(c.get("intitule") or "").strip()[:200]}
            ordre.append(a)
        else:
            if not vus[a]["nom"] and c.get("nom"):
                vus[a]["nom"] = str(c["nom"]).strip()[:200]
            if not vus[a]["intitule"] and c.get("intitule"):
                vus[a]["intitule"] = str(c["intitule"]).strip()[:200]
    return [vus[a] for a in ordre]


def _reperes(etudiants_connus, minimum=1, part=0.25):
    """Adresses étudiantes connues, regroupées par domaine (5 au plus par domaine). Seuls
    les domaines qui pèsent au moins « part » des étudiants connus comptent : une erreur
    isolée (un membre du personnel pris pour un étudiant) ne devient jamais un repère."""
    par_dom = {}
    for a in etudiants_connus:
        par_dom.setdefault(a.split("@", 1)[1], []).append(a)
    total = max(1, len(etudiants_connus))
    return {d: l[:5] for d, l in par_dom.items() if len(l) >= minimum and len(l) / total >= part}


ecole = base.ecole


def garde_fou(resultats, domaines_eleves):
    """Indépendant de l'IA : quand les élèves d'un compte ont leur propre domaine (par
    exemple mail.mcgill.ca), une adresse d'un AUTRE domaine de la même école (mcgill.ca)
    n'est jamais un élève. Seul un ajout à la main par l'étudiant passe outre."""
    if not domaines_eleves:
        return []
    ecoles = {}
    for d in domaines_eleves:
        ecoles.setdefault(ecole(d), set()).add(d)
    corriges = []
    for r in resultats:
        if r["groupe"] != "etudiant" or r["source"] == "manuel":
            continue
        dom = r["adresse"].rsplit("@", 1)[-1]
        eleves = ecoles.get(ecole(dom))
        if eleves and dom not in eleves:
            r.update(groupe="hors", type="personnel", garde=True,
                     raison=f"domaine du personnel : les élèves de l'école sont sur {sorted(eleves)[0]}", source=r["source"])
            corriges.append(r)
    return corriges


def trier(utilisateur, contacts, logique=None, reperes_compte=None):
    liste = _normaliser(contacts)
    res = {}  # adresse -> dict
    def poser(a, g, t, r, s):
        res[a] = {"adresse": a, "groupe": g, "type": t, "raison": r, "source": s}

    # 1. Cache
    deja = base.cache_lire([c["adresse"] for c in liste])
    # Un « incertain » n'est jamais définitif : on redemande (avec plus de repères qu'avant).
    deja = {a: v for a, v in deja.items() if v[0] != "incertain"}
    for a, (g, t, r, s) in deja.items():
        poser(a, g, t, r, "cache")

    # 2. Règles
    nouvelles_regles = []
    for c in liste:
        if c["adresse"] in res:
            continue
        r = regles.appliquer(c["adresse"], c["nom"])
        if r:
            poser(c["adresse"], r[0], r[1], r[2], "regle")
            nouvelles_regles.append((c["adresse"], r[0], r[1], r[2], "regle"))
    base.cache_ecrire(nouvelles_regles)

    # 2 bis. Logique de l'école apprise sur l'échantillon : gratuite, pas mise en
    # cache (elle dépend de l'école et peut être réapprise).
    if logique is not None:
        for c in liste:
            if c["adresse"] in res:
                continue
            r = logique_mod.appliquer(c, logique)
            if r:
                poser(c["adresse"], r[0], r[1], r[2], "logique")

    # 3. Claude, pour le reste, dans la limite du quota
    reste = [c for c in liste if c["adresse"] not in res]
    u = base.usage(utilisateur["id"])
    disponible = max(0, utilisateur["quota_mensuel"] - u["contacts_ia"])
    hors_quota = reste[disponible:]
    reste = reste[:disponible]
    for c in hors_quota:
        poser(c["adresse"], "incertain", "inconnu", "quota mensuel atteint : pas trié", "quota")

    # Les repères montrent à Claude le domaine et le format des adresses étudiantes de l'école.
    # Ceux du compte (tous ses élèves déjà trouvés) priment : ceux du seul lot ne servent qu'au
    # tout début, quand le compte n'a encore aucun élève.
    reperes = dict(reperes_compte) if reperes_compte else _reperes([a for a, v in res.items() if v["groupe"] == "etudiant"])
    lots = [reste[k:k + config.TAILLE_LOT] for k in range(0, len(reste), config.TAILLE_LOT)]
    erreurs, cout_total = [], 0.0
    budget_atteint = threading.Event()

    def traiter(lot):
        nonlocal cout_total
        with _verrou_budget:
            if base.depense_du_mois() >= config.BUDGET_MENSUEL_USD:
                budget_atteint.set()
                return lot, None
        with _appels:
            r = classeur().classer(lot, reperes)
        base.ajouter_usage(utilisateur["id"], contacts_ia=len(r.resultats), jetons_entree=r.jetons_entree,
                           jetons_sortie=r.jetons_sortie, cout_usd=r.cout_usd)
        with _verrou_budget:
            cout_total += r.cout_usd
        return lot, r

    if lots:
        with ThreadPoolExecutor(max_workers=max(1, config.PARALLELE)) as pool:
            for lot, r in pool.map(traiter, lots):
                if r is None:
                    for c in lot:
                        poser(c["adresse"], "incertain", "inconnu", "budget mensuel atteint : pas trié", "budget")
                    continue
                if r.erreur:
                    erreurs.append(r.erreur)
                a_cacher = []
                for i, c in enumerate(lot):
                    v = r.resultats.get(i)
                    if v:
                        poser(c["adresse"], v[0], v[1], v[2], "ia")
                        if v[0] != "incertain":  # un incertain sera redemandé plus tard
                            a_cacher.append((c["adresse"], v[0], v[1], v[2], "ia"))
                    else:
                        # Contact oublié ou lot en erreur : incertain, PAS mis en cache (on retentera).
                        poser(c["adresse"], "incertain", "inconnu", r.erreur or "non trié par l'IA", "erreur" if r.erreur else "ia")
                base.cache_ecrire(a_cacher)

    base.ajouter_usage(utilisateur["id"], contacts_total=len(liste))
    resultats = [res[c["adresse"]] for c in liste]
    # Garde-fou : jamais un élève sur le domaine du personnel de l'école (le cache est corrigé).
    corriges = garde_fou(resultats, list(reperes_compte or {}))
    base.cache_ecrire([(r["adresse"], r["groupe"], r["type"], r["raison"], "garde") for r in corriges])
    resume = {"etudiant": 0, "hors": 0, "incertain": 0}
    for r in resultats:
        resume[r["groupe"]] += 1
    u = base.usage(utilisateur["id"])
    return {
        "resultats": resultats,
        "resume": resume,
        "quota": {"mensuel": utilisateur["quota_mensuel"], "utilise": u["contacts_ia"]},
        "cout_usd": round(cout_total, 4),
        "erreurs": sorted(set(erreurs)),
        "budget_atteint": budget_atteint.is_set(),
    }
