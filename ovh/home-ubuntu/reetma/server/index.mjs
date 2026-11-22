// Reetma outside Vercel (the VPS, behind Caddy): serves the built site (dist/) and runs the api/ functions,
// with what vercel.json gave on Vercel: security headers, the SPA fallback and the daily audience purge.
//   node server/index.mjs        (PORT, default 3000; secrets from the environment, see README "Sur le VPS")
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import crypto from "node:crypto";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const apiDir = join(root, "api");
const PORT = Number(process.env.PORT) || 3000;

// The purge of the audience measurement needs a cron secret: one per process when none is configured.
if (!process.env.CRON_SECRET) process.env.CRON_SECRET = crypto.randomBytes(24).toString("hex");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const SECURITY = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};

function fileAt(path) {
  try {
    const st = statSync(path);
    return st.isFile() ? path : null;
  } catch {
    return null;
  }
}

/** dist/<path>, dist/<path>/index.html (prerendered pages), then dist/index.html (the app boots the route). */
function resolveStatic(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  const full = join(dist, clean);
  if (full !== dist && !full.startsWith(dist + sep)) return null;
  return fileAt(full) || fileAt(join(full, "index.html")) || fileAt(join(dist, "index.html"));
}

function serveStatic(req, res, pathname) {
  const file = resolveStatic(pathname);
  if (!file) {
    res.writeHead(404, SECURITY);
    return res.end("Not found");
  }
  const ext = extname(file);
  const immutable = pathname.startsWith("/assets/");
  const noCache = ext === ".html" || /\/(sw|registerSW|workbox-[^/]*)\.js$/.test(pathname) || pathname.endsWith(".webmanifest");
  res.writeHead(200, {
    ...SECURITY,
    "Content-Type": TYPES[ext] || "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : noCache ? "no-cache" : "public, max-age=3600",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

// /api/school/register → api/school/register.js. Files and folders starting with "_" are helpers, never routes.
const handlers = new Map();
async function apiHandler(pathname) {
  const parts = pathname.replace(/^\/api\/?/, "").replace(/\/$/, "").split("/");
  if (!parts[0] || parts.some((p) => !/^[a-z0-9-]+$/i.test(p) || p.startsWith("_"))) return null;
  const file = fileAt(join(apiDir, ...parts) + ".js");
  if (!file) return null;
  if (!handlers.has(file)) handlers.set(file, import(pathToFileURL(file).href).then((m) => m.default));
  return handlers.get(file);
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    for (const [k, v] of Object.entries(SECURITY)) res.setHeader(k, v);
    try {
      const handler = await apiHandler(pathname);
      if (typeof handler !== "function") {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end('{"error":"not_found"}');
      }
      await handler(req, res);
    } catch (err) {
      console.error("[api]", pathname, err?.code, err?.message);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end('{"error":"server_error"}');
    }
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, SECURITY);
    return res.end();
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => console.log(`[reetma] listening on :${PORT}`));

// The daily purge vercel.json ran at 3 h and 15 h UTC: every 12 h here, and once a minute after start.
async function purge() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/track`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    console.log("[cron] audience purge", r.status);
  } catch (err) {
    console.error("[cron] audience purge failed", err?.message);
  }
}
setTimeout(purge, 60_000);
setInterval(purge, 12 * 3600_000);
