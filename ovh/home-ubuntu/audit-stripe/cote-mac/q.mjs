// Requêtes en LECTURE SEULE sur la base de production (transaction read only, SELECT/WITH uniquement).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/Users/pierrecazaban/Projets/the-ai-certification/package.json');
const { neon } = require('@neondatabase/serverless');
const env = Object.fromEntries(readFileSync(process.env.ENVFILE, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const sql = neon(env.DATABASE_URL);
const requetes = process.argv.slice(2);
for (const r of requetes) {
  if (!/^\s*(select|with)\b/i.test(r) || /\b(insert|update|delete|drop|alter|truncate|create|grant)\b/i.test(r)) { console.error('refusé (lecture seule) :', r.slice(0, 60)); process.exit(1); }
}
const res = await sql.transaction(requetes.map((r) => sql(r)), { readOnly: true });
res.forEach((rows, i) => {
  if (requetes.length > 1) console.log(`-- [${i + 1}]`);
  if (process.env.JSONOUT) console.log(JSON.stringify(rows));
  else if (!rows.length) console.log('(aucune ligne)');
  else { console.log(Object.keys(rows[0]).join(' | ')); for (const row of rows) console.log(Object.values(row).map((v) => v instanceof Date ? v.toISOString() : v === null ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' | ')); }
});
