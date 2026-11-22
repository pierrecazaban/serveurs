// Recherche en LECTURE SEULE de liens de paiement externes dans toutes les colonnes texte de la base du site.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire('/Users/pierrecazaban/Projets/the-ai-certification/package.json');
const { neon } = require('@neondatabase/serverless');
const env = Object.fromEntries(
  readFileSync(process.env.ENVFILE, 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
    }),
);
const sql = neon(env.DATABASE_URL);
const ro = (q, p = []) => sql.transaction([sql(q, p)], { readOnly: true }).then((r) => r[0]);

const cols = await ro(
  "select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb', 'json') order by 1, 2",
);
const motifs = [
  'buy.stripe.com', 'beacons.ai', 'paypal', 'revolut.me', 'lydia', 'wise.com', 'sumup', 'mollie',
  'reetma-agency.com', 'reetma.com', 'linktr.ee', 'bit.ly', 'tinyurl', 'gumroad', 'lemonsqueezy',
  'payhip', 'stan.store', 'acct_1',
];
let total = 0;
for (const c of cols) {
  const cond = motifs.map((_, i) => '"' + c.column_name + '"::text ilike $' + (i + 1)).join(' or ');
  const rows = await ro('select count(*)::int n from "' + c.table_name + '" where ' + cond, motifs.map((m) => '%' + m + '%'));
  const n = rows[0].n;
  if (n) {
    total += n;
    const detail = [];
    for (const m of motifs) {
      const r = await ro('select count(*)::int k from "' + c.table_name + '" where "' + c.column_name + '"::text ilike $1', ['%' + m + '%']);
      if (r[0].k) detail.push(m + ': ' + r[0].k);
    }
    console.log('  ' + c.table_name + '.' + c.column_name + ' : ' + n + ' ligne(s) -> ' + detail.join(', '));
  }
}
console.log('colonnes texte examinees : ' + cols.length + ' | lignes avec un motif : ' + total);

const colsEmails = await ro("select column_name from information_schema.columns where table_name = 'emails' order by ordinal_position");
console.log('colonnes de la table emails : ' + colsEmails.map((x) => x.column_name).join(', '));
