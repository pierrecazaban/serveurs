import json, sys, collections, datetime as dt
S = sys.argv[1]
reg = json.load(open(S + '/secret/registrations.json'))
P = lambda iso: dt.datetime.fromisoformat(iso.replace('Z', '+00:00')) + dt.timedelta(hours=1)
payeurs = {r['email'] for r in reg if r['status'] in ('paid', 'refunded')}
print('Par heure (Paris) : inscriptions / ont ouvert Stripe / payées — heures avec au moins 4 inscriptions ou un abandon')
h = collections.defaultdict(lambda: [0, 0, 0, 0])
for r in reg:
    k = P(r['created_at']).strftime('%d/%m %Hh')
    h[k][0] += 1
    if r['payment_id']: h[k][1] += 1
    if r['status'] in ('paid', 'refunded'): h[k][2] += 1
    if not r['payment_id'] and r['email'] not in payeurs: h[k][3] += 1
for k in sorted(h, key=lambda k: (k[3:5], k[:2], k[6:])):
    v = h[k]
    if v[0] >= 4 or v[3]:
        print(f'  {k} : {v[0]:2d} inscr. / {v[1]:2d} Stripe / {v[2]:2d} payées / {v[3]:2d} abandons avant Stripe ' + ('  ◄ aucun n’a ouvert Stripe' if v[0] >= 3 and v[1] == 0 else ''))
print('\nAbandons avant Stripe : par école, langue, devise')
ab = [r for r in reg if not r['payment_id'] and r['email'] not in payeurs]
print('  école  :', collections.Counter(r['ecole'] or '(autre)' for r in ab).most_common(12))
print('  langue :', collections.Counter(r['locale'] for r in ab).most_common())
print('  devise :', collections.Counter(r['currency'] for r in ab).most_common())
print('  domaine e-mail :', collections.Counter(r['email'].split('@')[-1] for r in ab).most_common(12))
print('\nToutes inscriptions : par école (inscrits → payés)')
e = collections.defaultdict(lambda: [set(), set()])
for r in reg:
    k = r['ecole'] or r['ecole_nom'] or '(autre)'
    e[k][0].add(r['email'])
    if r['status'] in ('paid', 'refunded'): e[k][1].add(r['email'])
for k, v in sorted(e.items(), key=lambda kv: -len(kv[1][0])): print(f'  {k:28s} {len(v[0]):3d} personnes → {len(v[1]):3d} payées')
print('\nDevises / langues de toutes les inscriptions :', collections.Counter((r['locale'], r['currency'], r['amount_cents']) for r in reg).most_common())
print('\nProvenance (utm) des inscriptions :', collections.Counter(json.dumps(r['utm'], sort_keys=True)[:80] for r in reg).most_common(8))
