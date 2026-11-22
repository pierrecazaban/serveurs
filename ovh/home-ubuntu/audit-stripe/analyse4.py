import json, os, collections, datetime as dt, urllib.parse, warnings, bisect
warnings.simplefilter('ignore')
D = os.path.dirname(os.path.abspath(__file__))
L = lambda n: json.load(open(os.path.join(D, n + '.json')))
P = lambda ts: dt.datetime.utcfromtimestamp(ts) + dt.timedelta(hours=1)
d = lambda ts, fmt='%d/%m %H:%M': P(ts).strftime(fmt)
ch = {c['id']: c for c in L('charges')}
pis = {p['id']: p for p in L('payment_intents')}
payes = []
for s in L('sessions'):
    if s.get('payment_status') != 'paid': continue
    pi = pis.get(s.get('payment_intent')) or {}
    c = ch.get(pi.get('latest_charge')) or {}
    mail = ((s.get('customer_details') or {}).get('email') or s.get('customer_email') or '').lower()
    payes.append((c.get('created') or s['created'], mail.split('@')[-1], mail))
payes.sort()
brut = L('sm_envois_ovh')['brut']
# un « mail » = même ambassadeur, même instant
mails = collections.defaultdict(lambda: collections.Counter())
for quand, dom, u in brut: mails[(round(quand), u)][dom] += 1
envois = collections.defaultdict(list)   # domaine -> [(t, nb)]
for (t, u), cnt in mails.items():
    for dom, n in cnt.items(): envois[dom].append((t, n))
for dom in envois: envois[dom].sort()

ALIAS = {'ipsafr.onmicrosoft.com': 'ipsa.fr'}
print('=== POUR CHAQUE ÉCOLE : chaque envoi, puis les achats dans les 3 h / 24 h qui suivent ===')
for dom in ['ipsa.fr', 'edu.escp.eu', 'essec.edu', 'neoma-bs.com', 'ieseg.fr', 'skema.edu']:
    ach = [t for t, dd, _ in payes if dd == dom]
    print(f'\n-- {dom} : {sum(n for _, n in envois[dom])} destinataires en {len(envois[dom])} envois, {len(ach)} achats')
    ev = envois[dom]
    for i, (t, n) in enumerate(ev):
        suiv = ev[i + 1][0] if i + 1 < len(ev) else 9e12
        a3 = sum(1 for x in ach if t <= x < t + 3 * 3600)
        a24 = sum(1 for x in ach if t <= x < min(t + 24 * 3600, suiv))
        if n >= 50 or a3:
            print(f'   envoi {d(t)} à {n:4d} étudiants → achats dans les 3 h : {a3:2d} ; jusqu’à l’envoi suivant (24 h max) : {a24:2d}')
    avant = sum(1 for x in ach if not ev or x < ev[0][0])
    print(f'   achats AVANT le tout premier envoi à cette école : {avant}')

print('\n=== DÉLAI ENTRE LE DERNIER MAIL REÇU PAR L’ÉCOLE ET CHAQUE ACHAT ===')
tr = collections.Counter(); sans = []
for t, dom, mail in payes:
    ev = [x for x, _ in envois.get(dom, [])]
    i = bisect.bisect_right(ev, t) - 1
    if i < 0: sans.append((t, dom)); continue
    h = (t - ev[i]) / 3600
    tr['< 1 h' if h < 1 else '1–3 h' if h < 3 else '3–12 h' if h < 12 else '12–24 h' if h < 24 else '24–72 h' if h < 72 else '> 72 h'] += 1
for k in ['< 1 h', '1–3 h', '3–12 h', '12–24 h', '24–72 h', '> 72 h']: print(f'  {k:8s} : {tr[k]:3d}')
print('  achats sans aucun envoi préalable à ce domaine :', len(sans))
for t, dom in sans: print('     ', d(t), dom)

print('\n=== L’ACHETEUR AVAIT-IL LUI-MÊME REÇU UN MAIL ? ===')
recus = {}
for quand, dom, u in brut: pass
