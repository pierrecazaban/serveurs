import json, os, collections, datetime as dt, urllib.parse
D = os.path.dirname(os.path.abspath(__file__))
L = lambda n: json.load(open(os.path.join(D, n + '.json')))
def d(ts, fmt='%d/%m %H:%M'):
    return (dt.datetime.utcfromtimestamp(ts) + dt.timedelta(hours=1)).strftime(fmt)  # heure de Paris (hiver)
def eur(c): return f'{c/100:,.2f}'.replace(',', ' ')

a = L('account')
print('=== COMPTE ===')
print('id', a['id'], '| créé le', d(a['created'], '%d/%m/%Y %H:%M'), '| e-mail', a.get('email'))

print('\n=== SOLDE ===')
b = L('balance')
for k in ('available', 'pending', 'instant_available', 'connect_reserved'):
    for x in b.get(k) or []:
        print(f'  {k:18s} {eur(x["amount"])} {x["currency"]}  {x.get("source_types")}')

print('\n=== VIREMENTS VERS LA BANQUE (payouts) ===')
for p in L('payouts'):
    dest = p.get('destination')
    if isinstance(dest, dict):
        desc = f'{dest.get("object")} {dest.get("bank_name")} pays={dest.get("country")} devise={dest.get("currency")} …{dest.get("last4")} titulaire={dest.get("account_holder_name")} type={dest.get("account_holder_type")} id={dest.get("id")}'
    else:
        desc = str(dest)
    print(f'  {p["id"]} {eur(p["amount"])} {p["currency"]} statut={p["status"]} type={p["type"]} méthode={p["method"]} créé={d(p["created"])} arrivée={d(p["arrival_date"], "%d/%m/%Y")} auto={p.get("automatic")} échec={p.get("failure_code")}')
    print('     destination :', desc)

print('\n=== COMPTES BANCAIRES (lecture directe) ===')
print(' ', json.dumps(L('external_accounts'))[:400])

print('\n=== PERSONNES DU DOSSIER ===')
for p in L('persons'):
    print('  ', p.get('first_name'), p.get('last_name'), '| relation :', {k: v for k, v in (p.get('relationship') or {}).items() if v}, '| créé', d(p['created'], '%d/%m/%Y'))

print('\n=== WEBHOOKS ===')
for w in L('webhook_endpoints'):
    print(f'  {w["id"]} {w["url"]} statut={w["status"]} créé={d(w["created"], "%d/%m/%Y %H:%M")} évènements={w["enabled_events"]} app={w.get("application")} desc={w.get("description")}')

print('\n=== DOMAINES DE PAIEMENT ===')
for x in L('payment_method_domains'):
    print('  ', x.get('domain_name'), 'actif' if x.get('enabled') else 'inactif', d(x['created'], '%d/%m/%Y'))

print('\n=== MOUVEMENTS DU SOLDE (balance transactions) ===')
bt = L('balance_transactions')
par = collections.defaultdict(lambda: [0, 0, 0, 0])
for t in bt:
    k = (t['type'], t['currency'], t['status'])
    par[k][0] += 1; par[k][1] += t['amount']; par[k][2] += t['fee']; par[k][3] += t['net']
for k, v in sorted(par.items()):
    print(f'  {k[0]:22s} {k[1]} {k[2]:10s} n={v[0]:4d} brut={eur(v[1]):>12s} frais={eur(v[2]):>10s} net={eur(v[3]):>12s}')
tot = collections.defaultdict(int)
for t in bt: tot[t['currency']] += t['net']
print('  somme des nets :', {k: eur(v) for k, v in tot.items()})

print('\n=== PAIEMENTS (charges) ===')
ch = L('charges')
par = collections.defaultdict(lambda: [0, 0])
for c in ch:
    pi = c.get('payment_intent') if isinstance(c.get('payment_intent'), dict) else {}
    app = (c.get('metadata') or {}).get('app') or (pi.get('metadata') or {}).get('app') or '(sans étiquette)'
    k = (c['status'], app, c['currency'], bool(c.get('refunded')))
    par[k][0] += 1; par[k][1] += c['amount']
for k, v in sorted(par.items()):
    print(f'  statut={k[0]:10s} app={k[1]:24s} {k[2]} remboursé={k[3]!s:5s} n={v[0]:4d} total={eur(v[1])}')
# champs « détournement » sur chaque paiement
susp = [c['id'] for c in ch if c.get('transfer_data') or c.get('on_behalf_of') or c.get('application_fee') or c.get('application_fee_amount') or c.get('transfer') or c.get('destination') or c.get('application')]
print('  paiements avec reversement / tiers (transfer_data, on_behalf_of, application_fee, destination, application) :', len(susp), susp[:5])
pis = L('payment_intents')
susp = [p['id'] for p in pis if p.get('transfer_data') or p.get('on_behalf_of') or p.get('application_fee_amount') or p.get('application') or p.get('transfer_group')]
print('  intentions de paiement avec reversement / tiers :', len(susp), susp[:5])

print('\n=== SESSIONS DE PAIEMENT : QUEL SITE LES A CRÉÉES ? ===')
ss = L('sessions')
par = collections.defaultdict(lambda: [0, 0, 0])
for s in ss:
    hote = urllib.parse.urlparse(s.get('success_url') or '').netloc or '(aucune)'
    app = (s.get('metadata') or {}).get('app') or '(sans étiquette)'
    k = (hote, app, s.get('mode'), s.get('livemode'))
    par[k][0] += 1
    if s.get('payment_status') == 'paid':
        par[k][1] += 1; par[k][2] += s.get('amount_total') or 0
for k, v in sorted(par.items()):
    print(f'  site={k[0]:34s} app={k[1]:22s} mode={k[2]} live={k[3]} créées={v[0]:4d} payées={v[1]:4d} total payé={eur(v[2])}')
print('  1re session :', d(min(s['created'] for s in ss), '%d/%m/%Y %H:%M'), '| dernière :', d(max(s['created'] for s in ss), '%d/%m/%Y %H:%M'))
susp = [s['id'][:20] for s in ss if s.get('payment_link') or (s.get('payment_intent_data') or {}).get('transfer_data')]
print('  sessions issues d’un lien de paiement :', len(susp))

print('\n=== REMBOURSEMENTS ===')
for r in L('refunds'):
    print(f'  {r["id"]} {eur(r["amount"])} {r["currency"]} statut={r["status"]} motif={r.get("reason")} le {d(r["created"], "%d/%m/%Y %H:%M")} paiement={r.get("charge")}')

print('\n=== ÉVÈNEMENTS DU COMPTE (30 derniers jours) ===')
ev = L('events')
c = collections.Counter(e['type'] for e in ev)
for k, v in sorted(c.items()): print(f'  {k:50s} {v}')
print('  du', d(min(e['created'] for e in ev), '%d/%m/%Y %H:%M'), 'au', d(max(e['created'] for e in ev), '%d/%m/%Y %H:%M'))
