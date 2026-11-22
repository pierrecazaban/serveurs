import sqlite3, collections, json, datetime as dt, warnings
warnings.simplefilter('ignore')
c = sqlite3.connect('file:/data/smartmail.db?mode=ro', uri=True, timeout=30)
P = lambda ts: dt.datetime.utcfromtimestamp(ts) + dt.timedelta(hours=1)
us = {r[0]: (r[1] or '') for r in c.execute('select id, nom from utilisateurs')}
# heure -> domaine destinataire -> nb ; et par ambassadeur
heures = collections.defaultdict(lambda: collections.Counter())
jours_u = collections.defaultdict(lambda: collections.Counter())
mails = collections.defaultdict(set)
brut = []
for adresse, u, quand in c.execute("select adresse, utilisateur_id, quand from contactes where statut='recu' and utilisateur_id > 0"):
    dom = adresse.split('@')[-1].lower()
    t = P(quand)
    heures[t.strftime('%Y-%m-%d %H')][dom] += 1
    jours_u[t.strftime('%Y-%m-%d')][(u, dom)] += 1
    mails[(t.strftime('%Y-%m-%d'), u)].add(round(quand, 1))
    brut.append((quand, dom, u))
print('== destinataires « reçus » par jour : ambassadeur → école des destinataires (nb destinataires / nb de mails distincts) ==')
for j in sorted(jours_u):
    lignes = []
    paru = collections.defaultdict(list)
    for (u, dom), n in jours_u[j].items(): paru[u].append((n, dom))
    for u, l in sorted(paru.items()):
        l.sort(reverse=True)
        lignes.append(f'{us.get(u, u)} → ' + ', '.join(f'{dom} {n}' for n, dom in l[:3]) + f' [{len(mails[(j, u)])} mails]')
    print(' ', j, '|', ' ; '.join(lignes))
json.dump({'heures': {h: dict(v) for h, v in heures.items()}, 'brut': brut}, open('/tmp/sm_envois.json', 'w'))
print('lignes copiées depuis l’autre serveur (utilisateur_id = -1) :', c.execute("select count(*), min(quand), max(quand) from contactes where utilisateur_id = -1").fetchone())
