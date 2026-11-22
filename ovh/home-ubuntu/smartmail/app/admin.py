"""Administration en ligne de commande (sur le serveur).

  python -m app.admin creer "Pierre" --quota 20000   crée un accès, affiche le code UNE fois
  python -m app.admin code "Pierre"                  nouveau code (l'ancien ne marche plus)
  python -m app.admin quota "Pierre" 50000           change le quota mensuel (contacts triés par l'IA)
  python -m app.admin desactiver "Pierre"            coupe l'accès
  python -m app.admin activer "Pierre"
  python -m app.admin liste                          accès et consommation du mois
  python -m app.admin role lea@ecole.fr administrateur   rôle d'une adresse Outlook (le compte est
                                                     préparé s'il ne s'est jamais connecté)
"""

import argparse
import sqlite3
import sys

from . import base, config


def main(argv=None):
    p = argparse.ArgumentParser(prog="python -m app.admin")
    s = p.add_subparsers(dest="cmd", required=True)
    c = s.add_parser("creer"); c.add_argument("nom"); c.add_argument("--quota", type=int, default=20000)
    s.add_parser("code").add_argument("nom")
    q = s.add_parser("quota"); q.add_argument("nom"); q.add_argument("valeur", type=int)
    s.add_parser("desactiver").add_argument("nom")
    s.add_parser("activer").add_argument("nom")
    s.add_parser("liste")
    r = s.add_parser("role"); r.add_argument("email"); r.add_argument("role", choices=config.ROLES)
    a = p.parse_args(argv)

    if a.cmd == "creer":
        try:
            jeton = base.creer_utilisateur(a.nom, a.quota)
        except sqlite3.IntegrityError:
            print(f"« {a.nom} » existe déjà (utilisez « code » pour lui donner un nouveau code).", file=sys.stderr)
            return 1
        print(f"Accès créé pour {a.nom} (quota : {a.quota} contacts triés par l'IA par mois).")
        print(f"Code d'accès, à lui transmettre (il ne sera plus affiché) :\n{jeton}")
    elif a.cmd == "code":
        jeton = base.nouveau_code(a.nom)
        if not jeton:
            print(f"Aucun accès « {a.nom} ».", file=sys.stderr); return 1
        print(f"Nouveau code pour {a.nom} :\n{jeton}")
    elif a.cmd == "quota":
        if not base.modifier(a.nom, quota_mensuel=a.valeur):
            print(f"Aucun accès « {a.nom} ».", file=sys.stderr); return 1
        print(f"Quota de {a.nom} : {a.valeur} contacts par mois.")
    elif a.cmd in ("desactiver", "activer"):
        if not base.modifier(a.nom, actif=1 if a.cmd == "activer" else 0):
            print(f"Aucun accès « {a.nom} ».", file=sys.stderr); return 1
        print(f"Accès de {a.nom} {'réactivé' if a.cmd == 'activer' else 'désactivé'}.")
    elif a.cmd == "role":
        email = a.email.strip().lower()
        if "@" not in email:
            print("Indiquez l'adresse Outlook de la personne.", file=sys.stderr); return 1
        u = base.utilisateur_par_email(email)
        if u:
            if a.role == "ambassadeur" and u["role"] == "administrateur" and base.administrateurs_actifs() <= 1:
                print("Il doit rester au moins un administrateur.", file=sys.stderr); return 1
            base.definir_role(u["id"], a.role)
            print(f"{email} est maintenant {a.role}.")
        else:
            base.compte_outlook(email, role=a.role)
            print(f"{email} sera {a.role} dès sa première connexion avec Outlook.")
    elif a.cmd == "liste":
        lignes = base.rapport()
        print(f"{'Nom':28} {'Rôle':14} {'Actif':6} {'Outlook':8} {'Triés':>8} {'Par IA':>8} {'Quota':>8} {'Coût $':>8}")
        for r in lignes:
            print(f"{r['nom'][:28]:28} {r['role'][:14]:14} {'oui' if r['actif'] else 'non':6} {'oui' if r['outlook'] else 'non':8} "
                  f"{r['contacts_total']:>8} {r['contacts_ia']:>8} {r['quota_mensuel']:>8} {r['cout_usd']:>8.2f}")
        print(f"\nDépense du mois : {base.depense_du_mois():.2f} $ sur {config.BUDGET_MENSUEL_USD:.2f} $ de budget.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
