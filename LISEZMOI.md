# Serveurs (copie du 22/11/2026)

Tout le code et la configuration des deux serveurs, sans secrets ni données de personnes.

- `ovh/home-ubuntu/` : `/home/ubuntu` du serveur OVH (Smart Mail, Reetma, prospection, vérifs LinkedIn, serveur Accoste, scripts de contrôle Stripe, sauvegardes de code).
- `ovh/systeme/` : cron, service de relais, script de sauvegarde nocturne.
- `paris/opt/`, `paris/root/`, `paris/systeme/` : serveur de Paris (Smart Mail, vérifs LinkedIn, cron, sauvegarde).

## Tout retélécharger

Bouton vert « Code » puis « Download ZIP », ou :

    git clone https://github.com/pierrecazaban/serveurs.git

Les autres dépôts : the-ai-certification, smart-mail (branches `prod` et `tri-ia-extension`), prospection-ambassadeurs, reetma-site, accoste, shopify.

## Ce qui n'est pas ici (volontairement)

Fichiers `.env` et clés (Stripe, Anthropic, Resend, SSH, clé de chiffrement des sessions), bases de données, sessions de navigateur, listes d'étudiants et de prospects. Ils restent sur les serveurs ; les bases Smart Mail sont copiées chaque nuit d'un serveur à l'autre.
