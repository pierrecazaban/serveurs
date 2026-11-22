import json, os, collections, datetime as dt, urllib.parse, warnings
warnings.simplefilter('ignore')
D = os.path.dirname(os.path.abspath(__file__))
L = lambda n: json.load(open(os.path.join(D, n + '.json')))
P = lambda ts: dt.datetime.utcfromtimestamp(ts) + dt.timedelta(hours=1)
d = lambda ts, fmt='%d/%m %H:%M': P(ts).strftime(fmt)
ch = {c['id']: c for c in L('charges')}
pis = {p['id']: p for p in L('payment_intents')}
ss = [s for s in L('sessions') if urllib.parse.urlparse(s.get('success_url') or '').netloc == 'the-ai-certification.com']
payes = []
for s in ss:
    if s.get('payment_status') != 'paid': continue
    pi = pis.get(s.get('payment_intent')) or {}
    c = ch.get(pi.get('latest_charge')) or {}
    mail = (s.get('customer_details') or {}).get('email') or s.get('customer_email') or ''
    payes.append({'t': c.get('created') or s['created'], 'cree': s['created'], 'dom': mail.split('@')[-1].lower(), 'loc': s.get('locale'), 'ref': (s.get('metadata') or {}).get('reference', '')})
payes.sort(key=lambda x: x['t'])
print('paiements réussis :', len(payes), '| du', d(payes[0]['t'], '%d/%m %H:%M'), 'au', d(payes[-1]['t'], '%d/%m %H:%M'))

print('\n=== PAR JOUR (heure de Paris) : nombre de paiements et écoles ===')
jours = collections.defaultdict(list)
for p in payes: jours[d(p['t'], '%Y-%m-%d')].append(p)
for j in sorted(jours):
    c = collections.Counter(p['dom'] for p in jours[j])
    print(f'  {j} : {len(jours[j]):3d}  ' + ', '.join(f'{k} {v}' for k, v in c.most_common(6)))

print('\n=== PAR HEURE (chaque # = 1 paiement) ===')
for j in sorted(jours):
    h = collections.Counter(P(p['t']).hour for p in jours[j])
    print(f'  {j} ' + ' '.join(f'{x:02d}h:{h[x]}' for x in range(24) if h[x]))

print('\n=== « PACKS » : paiements à moins de 30 min les uns des autres (groupes de 4 et plus) ===')
grp = [[payes[0]]]
for p in payes[1:]:
    if p['t'] - grp[-1][-1]['t'] <= 1800: grp[-1].append(p)
    else: grp.append([p])
dans = 0
for g in grp:
    if len(g) >= 4:
        dans += len(g)
        c = collections.Counter(p['dom'] for p in g)
        duree = (g[-1]['t'] - g[0]['t']) / 60
        print(f'  {d(g[0]["t"], "%d/%m %H:%M")} → {d(g[-1]["t"], "%H:%M")} ({duree:4.0f} min) : {len(g):3d} paiements | ' + ', '.join(f'{k} {v}' for k, v in c.most_common(5)))
print(f'  → {dans} paiements sur {len(payes)} arrivent en groupes de 4+ ; {sum(1 for g in grp if len(g) == 1)} paiements isolés')

print('\n=== PAR ÉCOLE (domaine de l’e-mail) ===')
c = collections.Counter(p['dom'] for p in payes)
for k, v in c.most_common(40): print(f'  {v:4d}  {k}')

print('\n=== SESSIONS CRÉÉES vs PAYÉES PAR JOUR (abandon) ===')
cj = collections.Counter(d(s['created'], '%Y-%m-%d') for s in ss)
pj = collections.Counter(d(s['created'], '%Y-%m-%d') for s in ss if s.get('payment_status') == 'paid')
for j in sorted(cj): print(f'  {j} : créées {cj[j]:3d}, payées {pj[j]:3d}')
