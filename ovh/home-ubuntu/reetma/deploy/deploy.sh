#!/bin/sh
# Envoie Reetma sur le VPS et (re)démarre le conteneur.  Usage : deploy/deploy.sh ubuntu@158.69.232.131
set -e
CIBLE="$1"; [ -n "$CIBLE" ] || { echo "Usage : $0 utilisateur@ip-du-vps"; exit 1; }
ICI="$(cd "$(dirname "$0")/.." && pwd)"
rsync -az --delete --exclude node_modules --exclude dist --exclude dist-server --exclude .git \
  --exclude 'deploy/.env' --exclude .secrets.local "$ICI/" "$CIBLE:reetma/"
ssh "$CIBLE" 'cd reetma/deploy && test -f .env || { echo "Créez reetma/deploy/.env (voir env.exemple)"; exit 1; } && docker compose up -d --build && docker compose ps'
