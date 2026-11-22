// Applies db/schema.sql to the database in DATABASE_URL (every statement is idempotent).
//   DATABASE_URL=… node scripts/db-migrate.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const sql = neon(url);
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const statements = schema.split(";").map((s) => s.trim()).filter(Boolean);
for (const statement of statements) {
  await sql.query(statement);
  console.log("ok:", statement.split("\n")[0].slice(0, 70));
}
const tables = await sql.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
);
console.log("tables:", tables.map((t) => t.table_name).join(", "));
