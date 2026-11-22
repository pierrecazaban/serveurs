import json, sys, collections, datetime as dt
S = sys.argv[1]
reg = json.load(open(S + '/secret/registrations.json'))
ses = json.load(open(S + '/secret/sessions_reduit.json'))
P = lambda iso: dt.datetime.fromisoformat(iso.replace('Z', '+00:00')) + dt.timedelta(hours=1)
par_id = {s['id']: s for s in ses}
site = [s for s in ses if s['hote'] == 'the-ai-certification.com']
print(f'Base du site : {len(reg)} inscriptions | Stripe : {len(ses)} sessions dont {len(site)} créées par the-ai-certification.com')

print('\n1) Chaque inscription passée au paiement existe-t-elle dans TON compte Stripe ?')
avec = [r for r in reg if (r['payment_id'] or '').startswith('cs_')]
absents = [r for r in avec if r['payment_id'] not in par_id]
print(f'   inscriptions avec une session Stripe : {len(avec)} | introuvables dans le compte Reetma : {len(absents)}')
for r in absents: print('     !!', r['reference'], r['status'], r['created_at'], r['payment_id'][:18])

print('\n2) Chaque session Stripe du site correspond-elle à une inscription ?')
ids_reg = {r['id'] for r in reg}; pay_ids = {r['payment_id'] for r in reg}
orph = [s for s in site if s['id'] not in pay_ids and s['reg'] not in ids_reg]
remplacees = [s for s in site if s['id'] not in pay_ids and s['reg'] in ids_reg]
print(f'   sessions sans inscription : {len(orph)} | sessions remplacées par une plus récente pour la même inscription : {len(remplacees)}')
for s in orph: print('     !!', s['id'][:18], s['statut'], s['paiement'], s['cree'])
for s in remplacees: print('      remplacée :', s['ref'], s['statut'], s['paiement'])

print('\n3) Statuts et montants : base = Stripe ?')
ecarts = 0
payees_stripe = {s['id'] for s in site if s['paiement'] == 'paid'}
for r in avec:
    s = par_id.get(r['payment_id'])
    if not s: continue
    paye_base = r['status'] in ('paid', 'refunded')
    if paye_base != (s['paiement'] == 'paid'):
        ecarts += 1; print('     !! statut', r['reference'], 'base =', r['status'], '| Stripe =', s['statut'], s['paiement'])
    if s['montant'] != r['amount_cents'] or (s['devise'] or '').upper() != r['currency']:
        ecarts += 1; print('     !! montant', r['reference'], r['amount_cents'], r['currency'], '| Stripe', s['montant'], s['devise'])
    if r['status'] == 'refunded' and not s['rembourse']: ecarts += 1; print('     !! remboursé en base mais pas chez Stripe', r['reference'])
    if s['rembourse'] and r['status'] != 'refunded': ecarts += 1; print('     !! remboursé chez Stripe mais pas en base', r['reference'])
payees_base = {r['payment_id'] for r in reg if r['status'] in ('paid', 'refunded') and (r['payment_id'] or '').startswith('cs_')}
print(f'   écarts : {ecarts} | payées chez Stripe : {len(payees_stripe)} | payées/remboursées en base avec session Stripe : {len(payees_base)} | payées chez Stripe mais pas en base : {len(payees_stripe - payees_base)} | payées en base mais pas chez Stripe : {len(payees_base - payees_stripe)}')
for sid in payees_stripe - payees_base:
    s = par_id[sid]; print('     !! payé chez Stripe, absent/non payé en base :', s['ref'], s['mail'].split('@')[-1], s['cree'])

print('\n4) « Payé » en base SANS paiement Stripe (accès offerts ?)')
for r in reg:
    if r['status'] in ('paid', 'refunded') and not (r['payment_id'] or '').startswith('cs_'):
        print(f'     {r["reference"]} {r["status"]} montant={r["amount_cents"]} {r["currency"]} payment_id={r["payment_id"]!r} créé={P(r["created_at"]):%d/%m %H:%M} domaine={r["email"].split("@")[-1]} note={r["admin_note"]!r}')

print('\n5) Inscriptions qui n’ont JAMAIS ouvert la page de paiement (pas de session Stripe)')
sans = [r for r in reg if not r['payment_id']]
payeurs = {r['email'] for r in reg if r['status'] in ('paid', 'refunded')}
ont_paye_ensuite = [r for r in sans if r['email'] in payeurs]
print(f'   total : {len(sans)} | dont la même personne a payé avec une autre inscription : {len(ont_paye_ensuite)} | vrais abandons avant la page de paiement : {len(sans) - len(ont_paye_ensuite)}')
pj = collections.Counter(P(r['created_at']).strftime('%m-%d') for r in sans if r['email'] not in payeurs)
tj = collections.Counter(P(r['created_at']).strftime('%m-%d') for r in reg)
aj = collections.Counter(P(r['created_at']).strftime('%m-%d') for r in avec)
print('   par jour → inscriptions / ont ouvert Stripe / abandon avant Stripe (personne n’ayant jamais payé) :')
for j in sorted(tj): print(f'     {j} : {tj[j]:3d} / {aj[j]:3d} / {pj[j]:3d}')

print('\n6) Personnes distinctes')
pers = collections.defaultdict(list)
for r in reg: pers[r['email']].append(r)
n_pay = sum(1 for e, l in pers.items() if any(x['status'] in ('paid', 'refunded') for x in l))
n_stripe_sans = sum(1 for e, l in pers.items() if not any(x['status'] in ('paid', 'refunded') for x in l) and any(x['payment_id'] for x in l))
n_jamais = sum(1 for e, l in pers.items() if not any(x['status'] in ('paid', 'refunded') for x in l) and not any(x['payment_id'] for x in l))
print(f'   {len(pers)} personnes ont rempli le formulaire : {n_pay} ont payé, {n_stripe_sans} ont ouvert la page Stripe sans payer, {n_jamais} n’ont jamais ouvert la page Stripe')
