#!/bin/zsh
# Sauvegarde quotidienne de la base Smart Mail sur ce Mac (copie cohérente, 14 jours gardés).
set -e
SRV=ubuntu@158.69.232.131
DEST="$HOME/Sauvegardes/smart-mail"
mkdir -p "$DEST"; chmod 700 "$DEST"
F="$DEST/smartmail-$(date +%Y%m%d-%H%M).db"
ssh -o ConnectTimeout=30 $SRV 'sudo docker exec deploiement-smartmail-1 python -c "
import sqlite3; from app import config
s = sqlite3.connect(str(config.BASE), timeout=60); d = sqlite3.connect(\"/tmp/sauvegarde-jour.db\"); s.backup(d); d.close(); s.close()
" && sudo docker cp deploiement-smartmail-1:/tmp/sauvegarde-jour.db /tmp/sauvegarde-jour.db && sudo chown ubuntu /tmp/sauvegarde-jour.db && chmod 600 /tmp/sauvegarde-jour.db \
  && sudo docker exec deploiement-smartmail-1 rm -f /tmp/sauvegarde-jour.db'
scp -q $SRV:/tmp/sauvegarde-jour.db "$F"
ssh $SRV 'rm -f /tmp/sauvegarde-jour.db'
chmod 600 "$F"
if [ ! -s "$DEST/cle_coffre" ]; then
  ssh $SRV 'sudo docker exec deploiement-smartmail-1 cat /data/cle_coffre' > "$DEST/cle_coffre"; chmod 600 "$DEST/cle_coffre"
fi
ls -1t "$DEST"/smartmail-*.db | tail -n +15 | xargs -r rm -f
echo "$(date '+%F %T') ok $(du -h "$F" | cut -f1) $F" >> "$DEST/journal.txt"
