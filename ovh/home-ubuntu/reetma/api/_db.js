// Neon Postgres (DATABASE_URL is set by the Vercel ↔ Neon integration). Schema: db/schema.sql.
import { neon } from "@neondatabase/serverless";

let client = null;

function db() {
  if (!client) {
    if (!process.env.DATABASE_URL) throw Object.assign(new Error("DATABASE_URL is not configured"), { code: "no_db" });
    client = neon(process.env.DATABASE_URL);
  }
  return client;
}

/** Tagged template: await sql`SELECT … WHERE id = ${id}` → rows. Values are always sent as parameters. */
export function sql(strings, ...values) {
  return db()(strings, ...values);
}

/** Several statements in one transaction, sent in one request: await transaction((q) => [q`…`, q`…`]) → rows of each. */
export function transaction(build) {
  return db().transaction(build);
}
