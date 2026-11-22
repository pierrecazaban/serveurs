# Smart Mail — serveur et application

L'application (PWA installable sur téléphone et ordinateur, sans App Store ni réglage de sécurité) et l'API de tri des contacts par IA.

## Essayer tout de suite (sur ce Mac)

Double-clic sur **`Smart Mail - démo.command`** (dossier parent) : faux annuaire d'école, faux Claude, aucun mail envoyé.
Ou à la main :

```sh
SMARTMAIL_DEMO=1 SMARTMAIL_FAUX_CLAUDE=1 SMARTMAIL_FAUX_LATENCE=1 uv run uvicorn app.main:app --port 8766
```

## Connexion : juste son compte Outlook

Chaque étudiant ambassadeur, et chaque administrateur, ouvre l'application et tape **son adresse Outlook et son mot de passe**. C'est tout : pas d'inscription, pas de compte à créer, rien à configurer chez Microsoft.

1. Le serveur se connecte à Outlook web à sa place, dans un vrai navigateur (Chromium piloté par Playwright, comme les tests).
2. Si Microsoft demande une validation, l'application l'affiche : le nombre à toucher dans Authenticator, ou une case pour le code reçu par SMS.
3. Le serveur répond « oui » à « Rester connecté ? » et **garde la session Outlook** (les cookies du navigateur), chiffrée, dans `/data` sur le VPS. Il la rouvre au moins une fois par jour pour qu'elle reste vivante, même quand l'ordinateur de la personne est éteint.
4. L'appareil reçoit une session Smart Mail, **verrouillée sur ce seul compte** : elle ne donne accès qu'à ses destinataires, sa recherche et ses paramètres. Une session inutilisée 30 jours expire.

Le mot de passe sert une fois, à la saisie, puis il est effacé de la mémoire. Il n'est jamais écrit sur le disque. Le premier compte qui se connecte avec une adresse donnée crée le compte ; la même adresse retrouve le même compte sur tous les appareils.

**Rôles.** Tout le monde est *ambassadeur* par défaut. Les adresses listées dans `SMARTMAIL_ADMINS` deviennent *administrateur* à leur première connexion. Un administrateur voit l'écran **Administration** : les membres, leur session Outlook, leurs appareils, leur consommation ; il peut promouvoir quelqu'un ou couper un accès, ce qui déconnecte aussitôt tous ses appareils. Il reste toujours au moins un administrateur.

**Chaque personne** voit dans **Paramètres** ses appareils connectés, peut en déconnecter un, ou **retirer l'accès à Outlook** : le serveur oublie alors la session Outlook et déconnecte tous ses appareils.

## Comment ça trie

1. **Règles** (gratuit) : messageries perso, boîtes génériques, associations, numéros étudiants, sous-domaines étudiants/personnel.
2. **Logique de l'école** (`POST /v1/logique`) : Claude lit un échantillon d'environ 30 personnes et en déduit les formats d'adresse des étudiants et du personnel ; le serveur l'applique ensuite lui-même (gratuit).
3. **Claude** (`POST /v1/tri`) pour ce qui reste, par lots de 150, réponse JSON imposée. Sans indice, la réponse est « incertain », jamais une devinette.
4. **Cache** 180 jours : une adresse déjà triée ne coûte plus rien.

Garde-fous : code d'accès et quota mensuel par personne, plafond de dépense global (`SMARTMAIL_BUDGET_MENSUEL_USD`), 8 appels simultanés au plus à Anthropic.

## Mettre en ligne sur le VPS (Ubuntu 24.04)

1. Sur le VPS : installer Docker (`curl -fsSL https://get.docker.com | sh`).
2. Ici : `deploiement/deploy.sh ubuntu@IP-DU-VPS` (copie le code).
3. Sur le VPS : `cp smartmail/deploiement/.env.exemple smartmail/deploiement/.env`, puis remplir `DOMAINE` (ex. `51-83-12-34.sslip.io` = l'IP avec des tirets : HTTPS gratuit et automatique) et `ANTHROPIC_API_KEY`.
4. Relancer `deploiement/deploy.sh ubuntu@IP-DU-VPS`. L'app est sur `https://DOMAINE`.

## Administration (sur le VPS)

```sh
docker compose exec smartmail python -m app.admin creer "Pierre" --quota 20000   # affiche le code UNE fois
docker compose exec smartmail python -m app.admin liste                          # consommation et dépense du mois
docker compose exec smartmail python -m app.admin quota "Pierre" 50000
docker compose exec smartmail python -m app.admin desactiver "Pierre"
docker compose exec smartmail python -m app.admin role lea@ecole.fr administrateur   # même avant sa 1re connexion
```

Réglages de connexion dans `.env` : `SMARTMAIL_ADMINS` (adresses administratrices), `SMARTMAIL_DOMAINES` (n'accepter que les adresses de l'établissement), `SMARTMAIL_CLE_COFFRE` (clé de chiffrement des sessions Outlook ; vide = fichier `/data/cle_coffre` créé au premier démarrage, à sauvegarder avec la base).

## Tests

```sh
uv run playwright install chromium                   # une fois : le navigateur des tests de connexion
uv run pytest                                        # tests serveur (Claude simulé, faux Microsoft), dont le banc d'essai des 8 écoles
uv run python -m outils.eval_ecoles --contacts 600   # estimation ; ajouter --oui pour évaluer avec le VRAI Claude (~5 $)
uv run python outils/charge.py URL codes.json 3000   # charge : N utilisateurs en parallèle
# Application (depuis le dossier parent, serveur démo lancé sur 8766) :
APP_URL=http://127.0.0.1:8766 node node_modules/@playwright/test/cli.js test tests/app.spec.ts tests/ecoles.spec.ts
```

Banc d'essai (`app/ecoles.py`) : 8 écoles fictives aux conventions différentes (prenom.nom / p.nom, numéros étudiants,
sous-domaine etu., intitulés seuls, nom.prenom, multi-campus, anglophone, annuaire « sale » avec salles, listes,
invités #EXT#, partenaires, contacts perso, noms composés). Règle d'or vérifiée partout : aucun non-étudiant retenu.
Démo d'une école : `http://127.0.0.1:8766/?ecole=numeros`.

## Reste à faire

- Lecture de l'annuaire par le serveur, avec la session Outlook gardée (porter le relevé de `extension/adresses/` côté serveur), à la place de `/demo/annuaire`.
- Envoi réel en arrière-plan avec cette même session (porter `extension/publipostage/` côté serveur ; aujourd'hui l'écran d'envoi est une démonstration).
