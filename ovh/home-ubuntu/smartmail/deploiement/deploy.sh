#!/bin/sh
# Envoie Smart Mail sur le VPS et (re)démarre tout.  Usage : ./deploy.sh ubuntu@51.83.12.34
# Le redémarrage coupe les recherches et les envois en cours (ils reprennent ensuite
# tout seuls) : s'il y en a, on s'arrête. FORCER=1 ./deploy.sh … pour passer outre.
set -e
CIBLE="$1"; [ -n "$CIBLE" ] || { echo "Usage : $0 utilisateur@ip-du-vps"; exit 1; }
ICI="$(cd "$(dirname "$0")/.." && pwd)"
EN_COURS=$(ssh "$CIBLE" 'cd smartmail/deploiement 2>/dev/null && docker compose exec -T smartmail python -c "from app import base; print(len(base.travaux_a_reprendre()))" 2>/dev/null || echo 0' | tail -1)
if [ "${EN_COURS:-0}" != "0" ] && [ "${FORCER:-0}" != "1" ]; then
  echo "$EN_COURS recherche(s) ou envoi(s) en cours sur le serveur : mise en ligne annulée pour ne pas les couper."
  echo "Relancez quand ils sont finis, ou FORCER=1 $0 $CIBLE (ils reprendront après le redémarrage)."
  exit 2
fi
rsync -az --delete --exclude .venv --exclude data --exclude __pycache__ --exclude .pytest_cache --exclude 'deploiement/.env' --exclude 'deploiement/.env.*' --exclude extension "$ICI/" "$CIBLE:smartmail/"
# L'extension Smart Mail, que le serveur fait tourner dans Outlook.
rsync -az --delete "$ICI/../extension/" "$CIBLE:smartmail/extension/"
ssh "$CIBLE" 'cd smartmail/deploiement && test -f .env || { echo "Créez smartmail/deploiement/.env (voir .env.exemple)"; exit 1; } && docker compose up -d --build && docker compose ps'
