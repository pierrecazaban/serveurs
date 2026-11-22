// Runs last in `npm run build`: renders the public pages at build time and writes them into dist/, so a visitor
// that does not run JavaScript (Mollie's site check, link previews, search engines) gets each page's text and
// <head> tags instead of an empty <div id="root">. The browser still boots the full React app over that markup
// (src/main.tsx). Needs a fresh client build in dist/ and the server bundle in dist-server/:
//   vite build && vite build --ssr src/entry-server.tsx --outDir dist-server && node scripts/prerender.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format } from "node:util";

// The public pages. The others (student space, admin, confirmation and certificate pages) depend on the visitor
// and stay client-rendered: Vercel serves them dist/index.html (the home page), which boots the app.
const ROUTES = [
  "/",
  "/ecole",
  "/ecole/conditions",
  "/ecole/remboursement",
  "/aide",
  "/prendre-rendez-vous",
  "/legal/mentions",
  "/legal/privacy",
  "/school",
  "/school/terms",
  "/school/refund-policy",
  "/help",
  "/book-a-call",
];

// The tags <Seo /> sets on every page, whose static copies in index.html are replaced by the rendered ones.
// Keep in sync with HELMET_OWNED_SELECTORS in src/main.tsx, which drops those static copies once React mounts.
const HELMET_OWNED = ["description", "og:title", "og:description", "og:url", "og:type", "twitter:title", "twitter:description"];

// Same rule as schoolLangOf in src/lib/school/lang.ts, for a page that sets no <html lang> through <Seo />.
const FR_PREFIXES = ["/ecole", "/aide", "/certificat", "/prendre-rendez-vous"];
const langOf = (route) => (FR_PREFIXES.some((p) => route === p || route.startsWith(`${p}/`)) ? "fr" : "en");

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const EMPTY_ROOT = '<div id="root"></div>';

const template = readFileSync(join(dist, "index.html"), "utf8");
if (!template.includes(EMPTY_ROOT) || !/<html lang="[^"]*">/.test(template) || !/<title>[^<]*<\/title>/.test(template)) {
  console.error("dist/index.html is not a fresh client build (empty <div id=\"root\">, <html lang>, <title>): run `vite build` first.");
  process.exit(1);
}

const { render } = await import(pathToFileURL(join(root, "dist-server", "entry-server.js")).href);

/** Runs fn with console.error and console.warn collected: React and the libraries report rendering problems there. */
function collectingConsole(sink, fn) {
  const { error, warn } = console;
  console.error = console.warn = (...args) => sink.push(format(...args));
  try {
    return fn();
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

/** Removes the static copies of the helmet-owned tags that the rendered page provides. */
function dropStaticTags(page, helmetMeta) {
  const provided = new Set([...helmetMeta.matchAll(/(?:name|property)="([^"]+)"/g)].map((m) => m[1]));
  let out = page;
  for (const key of HELMET_OWNED) {
    if (provided.has(key)) out = out.replace(new RegExp(`[ \\t]*<meta\\s[^>]*(?:name|property)="${key}"[^>]*>[ \\t]*\\n?`, "g"), "");
  }
  return out;
}

function prerender(route) {
  const warnings = [];
  const { html, helmet } = collectingConsole(warnings, () => render(route));
  if (!html.trim()) throw new Error(`${route}: the page rendered nothing`);
  const title = helmet?.title.toString() ?? "";
  const meta = helmet?.meta.toString() ?? "";
  const link = helmet?.link.toString() ?? "";
  const lang = /\blang="([^"]+)"/.exec(helmet?.htmlAttributes.toString() ?? "")?.[1] ?? langOf(route);

  // Function replacers: the markup may contain "$&" and the other patterns String.replace expands.
  let page = template.replace(/<html lang="[^"]*">/, () => `<html lang="${lang}">`);
  if (/<title[^>]*>[^<]+<\/title>/.test(title)) {
    page = dropStaticTags(page, meta).replace(/<title>[^<]*<\/title>/, () => `${title}\n    ${meta}\n    ${link}`);
  } else {
    warnings.push("no <title> from <Seo />: the static head tags of index.html are kept");
  }
  page = page.replace(EMPTY_ROOT, () => `<div id="root">${html}</div>`);
  return { page, warnings };
}

// Everything is rendered before anything is written: a failure leaves dist/ as `vite build` made it.
const pages = ROUTES.map((route) => {
  const target = route === "/" ? join(dist, "index.html") : join(dist, route.slice(1), "index.html");
  if (route !== "/" && existsSync(join(root, "public", route.slice(1), "index.html"))) {
    throw new Error(`${route} is a static page in public/: remove it from ROUTES or from public/`);
  }
  return { route, target, ...prerender(route) };
});

for (const { target, page, warnings } of pages) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, page);
  console.log(`${relative(root, target)} written (${Math.round(page.length / 1024)} KB)${warnings.length ? `, ${warnings.length} warning(s):` : ""}`);
  for (const warning of warnings) console.log(`  ${warning.split("\n")[0].slice(0, 200)}`);
}
console.log(`${pages.length} pages prerendered`);

// Nothing is left to do: a timer a library left behind (React Query schedules one per query unless gcTime is
// Infinity, see src/App.tsx) must not keep the build hanging.
setTimeout(() => {
  console.warn("prerender: something kept Node alive after the pages were written (a timer in a dependency?); exiting");
  process.exit(0);
}, 5_000).unref();
