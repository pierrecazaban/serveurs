#!/bin/sh
# Sonde en lecture : mêmes pages, depuis un autre pays. Affiche code HTTP, URL finale, empreinte du contenu, liens sortants.
UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
for c in /ecole /school /canada "/register?lang=fr"; do
  r=$(curl -s -o /tmp/sonde.html -w '%{http_code} redirections=%{num_redirects} %{url_effective}' -L --max-time 25 -A "$UA" -H 'Referer: https://outlook.office.com/' "https://the-ai-certification.com$c")
  echo "$c → $r | sha=$(sha1sum /tmp/sonde.html 2>/dev/null | cut -c1-10 || shasum /tmp/sonde.html | cut -c1-10)"
done
echo "hôtes cités dans /ecole : $(grep -oE 'https?://[A-Za-z0-9.-]+' /dev/null $(curl -s -o /tmp/sonde.html -A "$UA" https://the-ai-certification.com/ecole; echo /tmp/sonde.html) | sed 's/^[^:]*://' | sort | uniq -c | sort -rn | tr '\n' ' ')"
echo "prix annoncés par le site (fr / en-us / en-ca) :"
for l in fr en-us en-ca; do
  curl -s --max-time 20 -X POST https://the-ai-certification.com/api/school -H 'content-type: application/json' -d "{\"action\":\"public_intake\",\"locale\":\"$l\"}" | python3 -c "import json,sys; d=json.load(sys.stdin); p=d.get('pricing') or {}; print('   $l :', p.get('priceCents'), p.get('currency'), '| session :', d.get('name'), '| état :', d.get('status'))"
done
rm -f /tmp/sonde.html
