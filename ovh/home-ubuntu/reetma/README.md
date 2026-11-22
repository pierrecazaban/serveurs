# Reetma

Site de Reetma (conseil en IA, automatisation, data et cloud) et de L'École, le programme étudiant.

- Front : React + Vite + Tailwind (`src/`), hébergé sur Vercel, domaine `https://reetma-agency.com`
- L'École en anglais (`/school`) et en français (`/ecole`) : mêmes composants, la langue vient de l'URL
  (`src/lib/school/lang.ts`). La langue choisie suit l'étudiant : paiement Mollie, e-mails, espace étudiant.
- Base de données : Neon Postgres (Francfort), schéma `db/schema.sql`
- Fonctions serveur Vercel (`api/`, 11 fonctions sur les 12 du plan gratuit ; les fichiers `_…` n'en sont pas)

## Parcours étudiant

1. Formulaire sur `/school` ou `/ecole` → `api/school/register.js` crée un paiement Mollie de 30 €
   (infos de l'étudiant dans les metadata, `app = "reetma-school"`).
2. Paiement sur Mollie → retour sur `/…/confirmation?pid=tr_…` : l'étudiant choisit son mot de passe
   (`api/account.js?action=setup`) et arrive directement dans son espace.
3. `api/school/mollie-webhook.js` recharge le paiement depuis Mollie et, une fois payé, envoie l'e-mail
   de confirmation (lien vers la création du mot de passe).
4. Espace étudiant (`/school/account`, `/ecole/compte`, `api/student.js`) : 3 modules à son rythme, puis le
   test final (12 questions corrigées côté serveur, 9 bonnes réponses pour réussir, soit 70 %, 5 tentatives
   par 24 h).
5. Réussite → certificat « AI Agents & Workflow Automation – Certificate of Completion » (n° `RE-XXXXXX`),
   vérification publique sur `/certificat/<code>`, bouton « Ajouter à LinkedIn » (organisme : Reetma ;
   renseigner `organizationId` dans `api/_course.js` pour afficher son logo).

Contenu du parcours : `api/_course.js` (servi aux seuls étudiants connectés) : les 3 modules (environ
1 heure chacun) et les 12 questions du test final, en français et en anglais, rédigés puis relus.

Comptes : mot de passe haché (scrypt), session dans un cookie httpOnly signé (`SESSION_SECRET`), mot de
passe oublié par lien valable 1 h (centre d'aide).

## Centre d'aide et e-mails

- `/help` et `/aide` : « Mot de passe oublié ? », « Remboursement », puis formulaire de ticket
  (`api/help.js`). Les tickets se lisent et se traitent dans `/admin/tickets` ; la réponse part par e-mail.
- Aucune adresse e-mail de contact n'est affichée sur le site, mentions légales comprises : on écrit par le centre
  d'aide (les mentions légales donnent aussi un téléphone). Seule l'adresse d'expédition `no-reply@reetma-agency.com`
  apparaît, sur la page de confirmation (`src/pages/school/Confirmation.tsx`), pour retrouver l'e-mail dans les spams.
- E-mails Resend depuis `no-reply@reetma-agency.com` (`api/_email.js`, `api/_ticketEmails.js`,
  `api/_certificateEmails.js`) : bouton « Centre d'aide » et mention « personne ne lit cette boîte ».

## Prise de rendez-vous

- `/book-a-call` et `/prendre-rendez-vous` : appels vidéo de 30 minutes, réservés aux entreprises (boutons « Book a call »
  de l'accueil ; le sujet « Projet d'entreprise » du centre d'aide y renvoie). Aucune fonction serveur en plus :
  `api/help.js` sert les créneaux, la réservation et l'annulation (`api/_bookingApi.js`).
- Créneaux calculés par le serveur, en heure de Paris (`BOOKING` dans `api/_booking.js`) : lundi–vendredi,
  9 h–12 h et 14 h–18 h, 24 h de préavis, jusqu'à 21 jours, jours fériés français exclus. **Horaires et jours de
  congé** : modifier `windows`, `weekdays`, `blockedDates` (ex. `["2026-12-24", "2026-12-31"]`) ou `horizonDays`
  (nombre de jours proposés), puis déployer : la page n'affiche que les jours et les créneaux envoyés par le serveur.
  Le visiteur voit les horaires dans son fuseau (et l'heure de Paris en petit).
- Un créneau ne peut être pris qu'une fois et deux appels ne se chevauchent pas, même après un changement
  d'horaires ou un allongement de `durationMinutes` (aucune durée n'est enregistrée par appel : les appels déjà pris
  comptent pour la nouvelle durée). **Raccourcir `durationMinutes`** seulement quand plus aucun appel pris avec
  l'ancienne durée n'est à venir, sinon un nouvel appel pourrait commencer avant la fin d'un appel plus long. Une
  adresse e-mail n'a qu'un appel à venir : pour changer d'horaire, la personne annule (lien de l'e-mail de
  confirmation, puis bouton) et réserve à nouveau.
- Filtre « entreprises seulement » (`api/_bookingFilter.js`, recopié dans `src/lib/booking/businessFilter.ts`) :
  refuse comme entreprise une école ou une université (dont `src/data/universities.json`) et les adresses e-mail
  étudiantes (.edu, .ac.uk, etu.…, univ-…, domaines d'écoles). Gmail, Outlook, etc. sont acceptés. Les noms qui
  sont aussi des lieux ou des marques (« Duke », « Dauphine ») ne comptent que seuls, avec un contexte d'études
  (« Duke '26 », « UW Seattle ») ou avec un mot de la vie étudiante (« Duke Investment Club », « Cornell Hyperloop ») :
  « Duke Energy » passe. **Après toute modification de `universities.json`**, régénérer la copie serveur :
  `node scripts/generate-booking-universities.mjs` (`--check` vérifie qu'elle est à jour, code 1 sinon).
- Admin : chaque réservation est un ticket « Appel réservé » (ouvert) dans `/admin/tickets`, filtre « Appels » (à
  venir d'abord). Le lien de la visio s'envoie en répondant au ticket. « Annuler l'appel » libère le créneau, prévient
  la personne par e-mail et clôt le ticket ; une annulation faite par la personne rouvre le ticket.
- E-mails (`api/_bookingEmails.js`) : confirmation avec l'invitation `.ics` jointe et le lien d'annulation, réponses
  de l'admin à un appel (marque Reetma), puis e-mail d'annulation. Schéma : colonnes `company`, `role`, `phone`, `call_*` de `tickets` (`db/schema.sql`).

## Back office

Un seul compte, défini par `ADMIN_EMAIL` et `ADMIN_PASSWORD`. La session (12 h) ne vaut que dans l'onglet où l'on
s'est connecté : un nouvel onglet redemande la connexion.

- `/admin` : inscriptions lues depuis Mollie, avec compte / modules / score / certificat de chaque étudiant (export
  CSV) ; en tête, un résumé de `/admin/stats` : qui est en ligne et sur quelle page, et le tunnel du jour.
- `/admin/tickets` : demandes du centre d'aide.
- `/admin/stats` : mesure d'audience interne (`src/lib/presence.ts` → `api/track.js`, décrite dans la politique de
  confidentialité), actualisée toutes les 30 s.
  - **En ligne maintenant**, page par page : un visiteur compte tant que son onglet est affiché et qu'il s'en est
    servi dans les 3 dernières minutes, puis jusqu'à 150 s après son dernier signal. Le formulaire d'inscription est
    compté sous la page de L'École (« dont n dans le formulaire », le détail par étape dans l'infobulle) ; une
    personne partie payer reste comptée « Sur la page de paiement Mollie » 10 min au plus.
  - **Comptes étudiants** : tous les comptes ouverts après paiement, sauf ceux marqués `students.nostats` (voir plus
    bas).
  - **Tunnel de vente** (aujourd'hui, 7 jours, 30 jours ou tout) : visite de L'École → formulaire commencé →
    université choisie → coordonnées remplies → étape paiement atteinte → parti payer sur Mollie (clic sur « Payer »)
    → paiement réussi → compte créé → module 1 terminé → 3 modules terminés → certificat obtenu. Jusqu'au départ vers
    Mollie, ce sont des visites ; à partir du paiement, tous les paiements (webhook Mollie) et tous les étudiants, comptés à la date où l'étape a lieu.
  - Ne sont pas comptés : les navigateurs qui se sont connectés à l'admin, et ceux où l'on a cliqué « Ne plus être
    compté sur ce navigateur » dans la politique de confidentialité (à faire sur ses autres appareils).

Statistiques (`/admin/stats`) : `EXCLUDED_COUNTRIES` dans `api/_track.js` (codes ISO à deux lettres, comparés à
l'en-tête `x-vercel-ip-country` que Vercel ajoute à chaque requête ; le pays lui-même n'est jamais enregistré)
permet d'exclure des pays de la mesure d'audience. La liste est vide : toutes les visites sont comptées.

Aucune page du site ne peut s'afficher dans le cadre (iframe) d'un autre site : `vercel.json` envoie
`Content-Security-Policy: frame-ancestors 'none'` et `X-Frame-Options: DENY`. Un autre site ne peut donc ni piéger
un clic sur `/auth` ou `/admin`, ni gonfler les statistiques avec une iframe invisible.

## Variables d'environnement (Vercel → Settings → Environment Variables)

| Nom | Rôle |
| --- | --- |
| `MOLLIE_API_KEY` | Clé Mollie : `live_…` en Production, `test_…` en Preview |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Compte unique de l'admin (mot de passe : 8 caractères minimum) |
| `RESEND_API_KEY` | Clé Resend (`re_…`, accès « envoi » suffit) |
| `EMAIL_FROM` | Expéditeur, ex. `L'École by Reetma <no-reply@reetma-agency.com>` (domaine vérifié dans Resend) |
| `SESSION_SECRET` | Secret de signature des sessions étudiantes (différent en Production et en Preview) |
| `DATABASE_URL` (+ `PG…`, `POSTGRES…`) | Créées par l'intégration Neon |
| `SITE_URL` | Optionnel : adresse publique du site, si elle diffère du domaine de la requête |
| `CRON_SECRET` | Optionnel (16 caractères aléatoires au moins) : une fois défini, seuls les appels qui le présentent lancent la purge de la mesure d'audience, et Vercel l'envoie de lui-même à ses tâches cron ; sans lui, la purge reconnaît l'en-tête `x-vercel-cron-schedule` de ces tâches |

Une variable modifiée ne s'applique qu'au déploiement suivant (Vercel → Deployments → Redeploy).
Les secrets locaux sont dans `.secrets.local` (jamais commité) ; `Déployer Reetma.command` et
`Configurer Preview.command` les recopient dans Vercel.

Le mode (`test` sur les previews, `live` en production) vient de la clé Mollie : la base est commune, mais
chaque requête filtre sur ce mode, si bien que les données de test n'apparaissent jamais en production.

## Base de données

`Déployer Reetma.command` applique `db/schema.sql` à la base de production avant de déployer, et annule le
déploiement si la base ne peut pas être mise à jour. Avant tout autre déploiement d'un code qui modifie
`db/schema.sql`, lancer :

```
DATABASE_URL=… node scripts/db-migrate.mjs   # applique db/schema.sql (idempotent)
```

### Conservation de la mesure d'audience

La politique de confidentialité annonce 48 h au plus pour la présence en ligne (`presence`) et 13 mois au plus pour
les étapes du parcours (`funnel_events`). `api/track.js` les supprime 25 h avant ces échéances : au plus une fois par
heure lors des battements, à chaque ouverture des statistiques et, les jours sans visite, par deux tâches cron
quotidiennes (`vercel.json` → `crons` : `GET /api/track` à 3 h et 15 h UTC, en production seulement). Sur l'offre
Hobby, chaque tâche part à une minute quelconque de l'heure prévue et une exécution peut manquer : la marge de 25 h
couvre ces deux cas. Suivi : Vercel → Settings → Cron Jobs → View Logs (réponse 200 attendue).

### Consommation Neon (à surveiller)

La mesure d'audience du back office (`src/lib/presence.ts` → `api/track.js`) écrit dans la base à chaque
changement de page, puis toutes les 60 s tant que l'onglet est affiché, avec une pause après 3 min sans
interaction. Neon ne met la base en veille qu'après 5 min sans requête : elle reste donc éveillée tant que
quelqu'un est sur le site, plus 5 à 8 min. Les deux purges quotidiennes la réveillent aussi quelques minutes (environ
1,3 CU-h par mois à 0,25 CU). Le temps d'éveil se compte en heures de calcul (CU-h).

- **Offre Free** : 100 CU-h par projet et par mois, soit environ 400 h d'éveil à 0,25 CU (un mois compte 730 h).
  Au-delà, Neon suspend la base jusqu'au mois suivant : espace étudiant, création du compte après paiement,
  centre d'aide et admin ne marchent plus (la mesure d'audience, elle, échoue sans bruit).
- **Où suivre** : Vercel → Storage → la base Neon (offre en cours et onglet Usage), ou la console Neon
  (« Open in Neon ») → le projet → Overview, encadré Usage : le calcul consommé depuis le début du mois, avec
  environ 1 h de retard. Regarder les premiers jours de trafic, puis chaque semaine.
- **Quand passer à l'offre payante (Launch)** : dès que la consommation, ramenée au mois, dépasse environ
  80 CU-h (2,7 CU-h par jour en moyenne), ou dès que le site a du trafic toute la journée. Launch est facturée à
  l'usage (0,106 $/CU-h en octobre 2026, soit environ 19 $/mois pour une base 0,25 CU jamais en veille), sur la
  facture Vercel quand la base a été créée depuis Vercel : Vercel → Storage → la base → Settings →
  Change Configuration (sinon console Neon → Billing). Autre levier : espacer encore les battements
  (`BEAT_MS`, `IDLE_MS` dans `src/lib/presence.ts`) ou sortir la mesure d'audience de Neon.

## Previews

Les déploiements de preview sont protégés par Vercel Authentication : Mollie ne peut pas y appeler le
webhook (il est appelé normalement en production). Pour tester une preview depuis le terminal :
`npx vercel curl /api/... --deployment <url-de-la-preview>`.

## Après une mise en ligne

Le site est une PWA (`vite-plugin-pwa`) : son service worker garde `index.html` et le JavaScript en cache. Un
navigateur déjà venu affiche donc une fois l'ancienne version, pendant qu'il télécharge la nouvelle, puis la nouvelle
au rechargement suivant. Recharger la page avant de conclure qu'une correction n'est pas en ligne.

## Domaine

`reetma-agency.com` (domaine et DNS chez OVH : A `@` et `www` → 158.69.232.131, le VPS, plus les enregistrements
Resend et la messagerie Zimbra). Le site tourne sur le VPS dans Docker (`deploy/`), derrière le Caddy de Smart Mail,
qui fait le HTTPS et redirige `www.reetma-agency.com` vers `reetma-agency.com`.

Le domaine public est écrit en dur dans `index.html`, `public/robots.txt`, `public/sitemap.xml`,
`public/**/index.html`, `src/components/Seo.tsx`, `src/config/school.ts`, `src/pages/school/School.tsx`
et `src/pages/legal/LegalNotice.tsx` : `grep -rn 'reetma\.com' src public index.html` les liste tous.

## En local

```
npm install
npx vite --port 8080
```

Les fonctions `api/` ne tournent qu'une fois déployées sur Vercel.
