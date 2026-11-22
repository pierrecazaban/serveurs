"""Le TYPE de chaque adresse, demandé à l'annuaire de l'école (Outlook) : une personne, un groupe
ou une liste de diffusion, une boîte partagée.

Pourquoi : un mail envoyé à un groupe arrive chez tous ses membres, EN PLUS du mail qu'ils reçoivent
à leur propre adresse (21/11 : une élève de l'IESEG l'a reçu trois fois). Le format de l'adresse ne
suffit pas à reconnaître un groupe (« blandinebury@ », « bdt2-group@ », « bachelor_retakes@ ») ;
l'annuaire, lui, le sait. La réponse est gardée dans la base : chaque adresse n'est demandée qu'une fois.

Types rendus : « personne », « groupe » (groupe Microsoft 365, liste de diffusion, salle…),
« partagee » (boîte partagée : déclarée comme une personne, mais sans prénom ni nom),
« absent » (l'annuaire ne la montre pas : on ne peut rien en dire).
"""

import asyncio

from . import base, navigateur

HORS = ("groupe", "partagee")  # jamais destinataires d'un envoi

_JS = r"""async ([adrs, tok]) => {
  const post = async (action, body) => {
    const r = await fetch(location.origin + '/owa/service.svc?action=' + action + '&app=People', {method: 'POST', credentials: 'include',
      headers: {'Content-Type': 'application/json; charset=utf-8', 'Action': action, 'Authorization': tok, 'X-Req-Source': 'People'},
      body: JSON.stringify(body)});
    return [r.status, await r.text()];
  };
  if (!window.__gal) {
    const f = await post('GetPeopleFilters', {});
    if (f[0] !== 200) return null;
    for (const x of JSON.parse(f[1])) if (x.DisplayName === 'Default Global Address List') window.__gal = x.FolderId.Id;
    if (!window.__gal) return null;
  }
  const un = async (a) => {
    const body = {"__type": "FindPeopleJsonRequest:#Exchange", "Header": {"__type": "JsonRequestHeaders:#Exchange", "RequestServerVersion": "V2018_01_08"},
      "Body": {"__type": "FindPeopleRequest:#Exchange", "IndexedPageItemView": {"__type": "IndexedPageView:#Exchange", "BasePoint": "Beginning", "Offset": 0, "MaxEntriesReturned": 5},
        "QueryString": a, "ParentFolderId": {"__type": "TargetFolderId:#Exchange", "BaseFolderId": {"__type": "AddressListId:#Exchange", "Id": window.__gal}},
        "PersonaShape": {"__type": "PersonaResponseShape:#Exchange", "BaseShape": "Default"}}};
    for (let i = 0; i < 3; i++) {
      const r = await post('FindPeople', body);
      if (r[0] === 200) {
        const rs = JSON.parse(r[1]).Body.ResultSet || [];
        const p = rs.find(x => ((x.EmailAddress || {}).EmailAddress || '').toLowerCase() === a);
        if (!p) return [a, 'absent'];
        const type = p.PersonaTypeString || '', boite = (p.EmailAddress || {}).MailboxType || '';
        if (type !== 'Person' || (boite && boite !== 'Mailbox' && boite !== 'OneOff' && boite !== 'Contact')) return [a, 'groupe'];
        return [a, (p.GivenName || p.Surname) ? 'personne' : 'partagee'];
      }
      await new Promise(s => setTimeout(s, 1500 * (i + 1)));
    }
    return [a, null];
  };
  const out = []; let k = 0;
  const travailleur = async () => { while (k < adrs.length) { const a = adrs[k++]; out.push(await un(a)); } };
  await Promise.all(Array.from({length: 6}, travailleur));
  return out;
}"""


async def verifier(uid, adresses):
    """{adresse: type} pour ces adresses, demandé à l'annuaire avec la session du compte (dans un
    contexte à part, refermé ensuite). Rend None si l'annuaire ne répond pas (session, panne)."""
    adresses = sorted({a.strip().lower() for a in adresses if a and "@" in a})
    if not adresses:
        return {}
    ouvert = await navigateur.ouvrir(uid, {})
    if not ouvert:
        return None
    contexte, page = ouvert
    jetons = {}

    def capter(req):
        h = req.headers.get("authorization") or ""
        if h.lower().startswith("bearer "):
            jetons["t"] = h
    contexte.on("request", capter)
    types = {}
    try:
        await page.goto("https://outlook.office.com/people/", wait_until="domcontentloaded")
        for _ in range(60):
            if jetons.get("t"):
                break
            await asyncio.sleep(0.5)
        if not jetons.get("t"):
            return None
        await asyncio.sleep(2)
        for i in range(0, len(adresses), 200):
            lot = await page.evaluate(_JS, [adresses[i:i + 200], jetons["t"]])
            if lot is None:
                return None
            types.update({a: t for a, t in lot if t})
    except Exception as x:
        print(f"[annuaire] compte {uid} : types non lus ({type(x).__name__})", flush=True)
        if not types:
            return None
    finally:
        try:
            await contexte.close()
        except Exception:
            pass
    base.types_noter(types)
    return types
