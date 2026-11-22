#!/bin/sh
# Sauvegarde de nuit de Smart Mail (22/11) : une copie cohérente de la base et la clé qui déchiffre les
# sessions, envoyées sur l'AUTRE serveur (7 nuits gardées là-bas, 2 ici). Usage : smartmail-sauvegarde.sh <autre serveur> <nom d'ici>
set -e
AUTRE="$1"; ICI="$2"; C=deploiement-smartmail-1; D=/var/backups/smartmail; J=$(date +%Y%m%d)
mkdir -p "$D"; chmod 700 "$D"
docker exec "$C" python -c "
import sqlite3
s = sqlite3.connect('/data/smartmail.db'); d = sqlite3.connect('/data/nuit.db'); s.backup(d); d.close()
print(sqlite3.connect('/data/nuit.db').execute('pragma integrity_check').fetchone()[0])" | grep -qx ok
docker cp "$C":/data/nuit.db "$D/smartmail-$ICI-$J.db"; docker exec "$C" rm -f /data/nuit.db
# (la clé n'existe qu'après la première connexion d'un ambassadeur sur ce serveur)
docker cp "$C":/data/cle_coffre "$D/cle_coffre-$ICI" 2>/dev/null && chmod 600 "$D/cle_coffre-$ICI" || true
gzip -f "$D/smartmail-$ICI-$J.db"; chmod 600 "$D/smartmail-$ICI-$J.db.gz"
{ echo "put $D/smartmail-$ICI-$J.db.gz"; test -f "$D/cle_coffre-$ICI" && echo "put $D/cle_coffre-$ICI"; true; } | sftp -q -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$HOME/.ssh/sauvegarde_ed25519" -b - "sauvegardes@$AUTRE"
find "$D" -name "smartmail-$ICI-*.db.gz" -mtime +1 -delete
echo "$(date -u +%FT%TZ) sauvegarde $ICI envoyée à $AUTRE ($(du -h "$D/smartmail-$ICI-$J.db.gz" | cut -f1))"
