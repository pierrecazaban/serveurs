import sqlite3, json, re
c = sqlite3.connect('file:/data/smartmail.db?mode=ro', uri=True, timeout=30)
us = {r[0]: r[1] for r in c.execute('select id, nom from utilisateurs')}
print('== tâches d’envoi : lien et langue du message de chaque ambassadeur ==')
for u, typ, statut, par, prog, msg, maj in c.execute("select utilisateur_id, type, statut, params, progression, message, maj from taches order by utilisateur_id, maj"):
    try: p = json.loads(par or '{}')
    except Exception: p = {}
    txt = json.dumps(p, ensure_ascii=False)
    liens = sorted(set(re.findall(r'https?://[^\s"\\<>)]+', txt)))
    if typ != 'envoi': 
        continue
    corps = ''
    for k in ('message', 'texte', 'corps', 'modele'):
        v = p.get(k)
        if isinstance(v, dict): corps = json.dumps(v, ensure_ascii=False)
        elif isinstance(v, str): corps = v
        if corps: break
    objet = p.get('objet') or (p.get('message') or {}).get('objet') if isinstance(p.get('message'), dict) else p.get('objet')
    print(f'\n  [{u}] {us.get(u)} | statut={statut} | maj={maj} | clés={list(p.keys())[:14]}')
    print(f'     liens : {liens}')
    print(f'     objet : {str(objet)[:120]!r}')
    print(f'     début : {re.sub(chr(10), " ⏎ ", corps)[:260]!r}')
