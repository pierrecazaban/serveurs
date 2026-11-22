# Audit en LECTURE SEULE du compte Stripe (uniquement des GET). La clé reste sur le serveur et n'est jamais affichée.
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request, base64

D = os.path.dirname(os.path.abspath(__file__))
cle = None
for l in open('/home/ubuntu/reetma/deploy/.env'):
    if l.startswith('STRIPE_SECRET_KEY='):
        cle = l.split('=', 1)[1].strip().strip('"\'')
assert cle
AUTH = 'Basic ' + base64.b64encode((cle + ':').encode()).decode()

def get(chemin, params=None):
    url = 'https://api.stripe.com/v1' + chemin
    if params:
        url += '?' + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url, headers={'Authorization': AUTH})  # méthode GET
    for essai in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            corps = e.read().decode('utf-8', 'replace')
            if e.code == 429 and essai < 3:
                time.sleep(2 + essai * 2); continue
            try:
                return {'error': json.loads(corps).get('error', {}), 'http': e.code}
            except Exception:
                return {'error': {'message': corps[:300]}, 'http': e.code}
        except Exception as e:
            if essai == 3:
                return {'error': {'message': str(e)}, 'http': 0}
            time.sleep(2)

def tout(chemin, params=None, maxi=20000):
    params = dict(params or {}); params['limit'] = 100
    sortie = []
    while True:
        d = get(chemin, params)
        if 'error' in d:
            return {'erreur': d['error'].get('message'), 'http': d.get('http'), 'partiel': sortie}
        sortie += d.get('data', [])
        if not d.get('has_more') or not d.get('data') or len(sortie) >= maxi:
            return sortie
        params['starting_after'] = d['data'][-1]['id']

def ecrire(nom, valeur):
    with open(os.path.join(D, nom + '.json'), 'w') as f:
        json.dump(valeur, f)
    n = len(valeur) if isinstance(valeur, list) else ('ERREUR ' + str(valeur.get('erreur'))[:140] if isinstance(valeur, dict) and 'erreur' in valeur else 'objet')
    print(f'{nom:28s} {n}', flush=True)

ecrire('account', get('/account'))
ecrire('balance', get('/balance'))
ecrire('payouts', tout('/payouts', {'expand[]': 'data.destination'}))
ecrire('charges', tout('/charges', {'expand[]': ['data.balance_transaction', 'data.payment_intent']}))
ecrire('sessions', tout('/checkout/sessions'))
ecrire('payment_intents', tout('/payment_intents'))
ecrire('balance_transactions', tout('/balance_transactions'))
ecrire('refunds', tout('/refunds'))
ecrire('disputes', tout('/disputes'))
ecrire('transfers', tout('/transfers'))
ecrire('application_fees', tout('/application_fees'))
ecrire('topups', tout('/topups'))
ecrire('payment_links', tout('/payment_links'))
ecrire('webhook_endpoints', tout('/webhook_endpoints'))
ecrire('customers', tout('/customers'))
ecrire('products', tout('/products'))
ecrire('prices', tout('/prices'))
ecrire('subscriptions', tout('/subscriptions', {'status': 'all'}))
ecrire('invoices', tout('/invoices'))
ecrire('connected_accounts', tout('/accounts'))
ecrire('external_accounts', tout('/accounts/acct_1UYmSdF8O4r9cd54/external_accounts'))
ecrire('persons', tout('/accounts/acct_1UYmSdF8O4r9cd54/persons'))
ecrire('events', tout('/events'))
ecrire('setup_intents', tout('/setup_intents'))
ecrire('payment_method_domains', tout('/payment_method_domains'))
ecrire('apple_pay_domains', tout('/apple_pay/domains'))
ecrire('coupons', tout('/coupons'))
ecrire('promotion_codes', tout('/promotion_codes'))
ecrire('reviews', tout('/reviews'))
ecrire('early_fraud_warnings', tout('/radar/early_fraud_warnings'))
ecrire('files', tout('/files'))
ecrire('country_spec', get('/country_specs/FR'))
print('terminé', time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime()))
