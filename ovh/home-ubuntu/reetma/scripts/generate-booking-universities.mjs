// Writes api/_bookingUniversities.js from src/data/universities.json (the server copy used by the booking filter).
// Run it after any change to the universities list:  node scripts/generate-booking-universities.mjs
// With --check, writes nothing and exits with code 1 when the copy is out of date.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const universities = JSON.parse(readFileSync(new URL("../src/data/universities.json", import.meta.url), "utf8"));
const rows = universities.map((u) => [u.name, u.short_name, u.email_domains]);
const out = `// Generated from src/data/universities.json by scripts/generate-booking-universities.mjs: do not edit by hand.
// [name, short name, email domains] of each university, for the business-only filter of the booking calendar.
export const UNIVERSITY_TERMS = ${JSON.stringify(rows)};
`;
const target = new URL("../api/_bookingUniversities.js", import.meta.url);
if (process.argv.includes("--check")) {
  if (!existsSync(target) || readFileSync(target, "utf8") !== out) {
    console.error("api/_bookingUniversities.js is out of date: run node scripts/generate-booking-universities.mjs");
    process.exit(1);
  }
  console.log(`api/_bookingUniversities.js is up to date (${rows.length} universities)`);
} else {
  writeFileSync(target, out);
  console.log(`api/_bookingUniversities.js written (${rows.length} universities)`);
}
