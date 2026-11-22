import json, os, collections, datetime as dt, urllib.parse, warnings
warnings.simplefilter('ignore')
D = os.path.dirname(os.path.abspath(__file__))
L = lambda n: json.load(open(os.path.join(D, n + '.json')))
P = lambda ts: dt.datetime.utcfromtimestamp(ts) + dt.timedelta(hours=1)
d = lambda ts, fmt='%d/%m %H:%M': P(ts).strftime(fmt)
eur = lambda c: f'{c/100:,.2f}'.replace(',', ' ')
ev = L('events')

print('=== COMPTE BANCAIRE : création / modification (évènements) ===')
for e in sorted(ev, key=lambda e: e['created']):
    if e['type'].startswith('account.external_account'):
        o = e['data']['object']
        print(f'  {d(e["created"], "%d/%m/%Y %H:%M")} {e["type"]} → {o.get("bank_name")} {o.get("country")} …{o.get("last4")} id={o.get("id")} défaut={o.get("default_for_currency")} | origine requête={e.get("request")}')

print('\n=== MODIFICATIONS DU COMPTE (account.updated) : ce qui a changé ===')
def aplatir(x, p=''):
    out = []
    if isinstance(x, dict):
        for k, v in x.items(): out += aplatir(v, f'{p}.{k}' if p else k)
    else: out.append(p)
    return out
for e in sorted(ev, key=lambda e: e['created']):
    if e['type'] == 'account.updated':
        prev = e['data'].get('previous_attributes') or {}
        cles = aplatir(prev)
        gros = sorted({c.split('.')[0] + ('.' + c.split('.')[1] if '.' in c else '') for c in cles})
        print(f'  {d(e["created"], "%d/%m/%Y %H:%M")} : {", ".join(gros)[:230]}')
        o = e['data']['object']
        for champ in ('email',):
            if champ in prev: print('      e-mail avant :', prev[champ], '→', o.get(champ))
        s_prev = (prev.get('settings') or {})
        if 'payouts' in s_prev: print('      virements avant :', s_prev['payouts'], '→', (o.get('settings') or {}).get('payouts'))
        if 'external_accounts' in prev: print('      comptes bancaires avant :', json.dumps(prev['external_accounts'])[:300])

print('\n=== VIREMENT DU 20/11 : évènements ===')
for e in sorted(ev, key=lambda e: e['created']):
    if e['type'].startswith('payout.'):
        o = e['data']['object']
        print(f'  {d(e["created"], "%d/%m/%Y %H:%M")} {e["type"]} {eur(o["amount"])} € statut={o["status"]} destination={o.get("destination")} trace={o.get("trace_id")}')

print('\n=== ARGENT EN ATTENTE : date de disponibilité (donc prochains virements) ===')
bt = L('balance_transactions')
att = collections.defaultdict(lambda: [0, 0])
for t in bt:
    if t['status'] == 'pending':
        k = (d(t['available_on'], '%Y-%m-%d'), t['currency']); att[k][0] += 1; att[k][1] += t['net']
for k, v in sorted(att.items()): print(f'  disponible le {k[0]} : {v[0]:3d} paiements, net {eur(v[1])} {k[1]}')
dispo = collections.defaultdict(lambda: [0, 0])
for t in bt:
    if t['status'] == 'available' and t['type'] in ('charge', 'payment'):
        k = d(t['available_on'], '%Y-%m-%d'); dispo[k][0] += 1; dispo[k][1] += t['net']
print('  déjà disponibles (inclus dans le virement du 20/11) :')
for k, v in sorted(dispo.items()): print(f'    disponible le {k} : {v[0]:3d} paiements, net {eur(v[1])} €')

print('\n=== FRAIS STRIPE HORS PAIEMENTS (stripe_fee) ===')
for t in bt:
    if t['type'] == 'stripe_fee': print(f'  {d(t["created"], "%d/%m %H:%M")} {eur(t["amount"])} € : {t.get("description")}')

print('\n=== MOYENS DE PAIEMENT UTILISÉS ===')
ch = L('charges')
c = collections.Counter()
for x in ch:
    if x['status'] == 'succeeded':
        pm = x.get('payment_method_details') or {}
        t = pm.get('type'); w = ((pm.get('card') or {}).get('wallet') or {}).get('type') if t == 'card' else None
        pays = (pm.get('card') or {}).get('country') if t == 'card' else None
        c[(t, w)] += 1
for k, v in c.most_common(): print(f'  {k[0]} {k[1] or ""} : {v}')
c = collections.Counter((x.get('payment_method_details') or {}).get('card', {}).get('country') for x in ch if x['status'] == 'succeeded')
print('  pays des cartes :', dict(c.most_common()))
c = collections.Counter((x.get('outcome') or {}).get('risk_level') for x in ch if x['status'] == 'succeeded')
print('  niveau de risque Stripe :', dict(c))
c = collections.Counter((x.get('calculated_statement_descriptor')) for x in ch if x['status'] == 'succeeded')
print('  libellé sur le relevé des acheteurs :', dict(c))
print('  échecs :', collections.Counter(((x.get('failure_code'), (x.get('outcome') or {}).get('seller_message')) ) for x in ch if x['status'] == 'failed').most_common())

print('\n=== SESSIONS HORS SITE PRINCIPAL (détail) ===')
for s in sorted(L('sessions'), key=lambda s: s['created']):
    h = urllib.parse.urlparse(s.get('success_url') or '').netloc
    if h != 'the-ai-certification.com':
        print(f'  {d(s["created"], "%d/%m/%Y %H:%M")} site={h} app={(s.get("metadata") or {}).get("app")} montant={eur(s.get("amount_total") or 0)} {s.get("currency")} statut={s.get("status")}/{s.get("payment_status")}')
