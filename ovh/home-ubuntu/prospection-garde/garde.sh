#!/bin/bash
# Garde de la prospection LinkedIn (toutes les 10 min, crontab root) :
#  1. lève un verrou d'agent de plus de 2 h 30 et arrête l'agent bloqué ;
#  2. relance un Chrome qui ne répond plus (mêmes réglages que start.sh, la session LinkedIn reste dans le profil) ;
#  3. referme les onglets vides en trop quand aucun agent ni l'outil de vérification ne tourne sur ce Chrome.
C=prospection-prospection-1
ETAT=/home/ubuntu/prospection/state
LOG=/home/ubuntu/prospection-garde/garde.log
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36"
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
docker ps -q -f "name=^${C}$" | grep -q . || exit 0
CHROME=$(docker exec $C node -e "console.log(require('playwright').chromium.executablePath())")
age() { echo $(( $(date +%s) - $(stat -c %Y "$1") )); }

for acct in "9333 pierre" "9334 hippolyte"; do
  set -- $acct; port=$1; nom=$2
  [ -f "$ETAT/pause-$nom" ] && continue   # Chrome mis en pause volontairement : ne pas le relancer
  agent=$ETAT/agent-$port.lock; verif=$ETAT/verif-$port.lock

  # 1. Verrou d'agent périmé
  if [ -f "$agent" ] && [ "$(age "$agent")" -gt 9000 ]; then
    pid=$(cat "$agent")
    docker exec $C kill "$pid" 2>/dev/null; sleep 2; docker exec $C kill -9 "$pid" 2>/dev/null
    rm -f "$agent"; log "$nom : verrou de plus de 2 h 30 levé, agent $pid arrêté"
  fi
  # Verrou de l'outil de vérification abandonné (il le rafraîchit à chaque contact)
  if [ -f "$verif" ] && [ "$(age "$verif")" -gt 1800 ]; then rm -f "$verif"; log "$nom : verrou de vérification abandonné levé"; fi

  # 2. Chrome figé ou arrêté
  # vrai test de pilotage (le simple /json/version peut répondre alors que Chrome est figé)
  if ! timeout 60 docker exec $C node -e "require('playwright').chromium.connectOverCDP('http://127.0.0.1:$port',{timeout:30000}).then(b=>b.close()).then(()=>process.exit(0)).catch(()=>process.exit(1))"; then
    if [ -f "$agent" ]; then pid=$(cat "$agent"); docker exec $C kill -9 "$pid" 2>/dev/null; rm -f "$agent"; fi
    docker exec $C sh -c "pkill -f -- '--remote-debugging-port=$port'; sleep 3; pkill -9 -f -- '--remote-debugging-port=$port'; rm -f /data/$nom/SingletonLock /data/$nom/SingletonSocket /data/$nom/SingletonCookie"
    docker exec -d $C sh -c "exec '$CHROME' --remote-debugging-port=$port --user-data-dir=/data/$nom --no-first-run --no-default-browser-check --no-sandbox --lang=fr-FR --user-agent='$UA' --window-size=1400,880 https://www.linkedin.com/feed/ >/dev/null 2>&1"
    log "$nom : Chrome $port ne répondait plus, relancé"
    continue
  fi

  # 3. Onglets vides en trop (seulement quand personne ne s'en sert)
  if [ ! -f "$agent" ] && [ ! -f "$verif" ]; then
    n=$(docker exec $C node -e "
      (async () => { const u = 'http://127.0.0.1:$port';
        const t = await (await fetch(u + '/json/list', {signal: AbortSignal.timeout(10000)})).json();
        const pages = t.filter(x => x.type === 'page'); const vides = pages.filter(x => x.url === 'about:blank');
        let n = 0; for (const x of vides.slice(pages.length === vides.length ? 1 : 0)) { await fetch(u + '/json/close/' + x.id); n++; }
        console.log(n); })().catch(() => console.log(0));")
    [ "${n:-0}" -gt 0 ] && log "$nom : $n onglets vides fermés"
  fi
done
exit 0
