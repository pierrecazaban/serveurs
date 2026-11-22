// Shared bits of the outreach scripts: config, the prospection Chrome (port 9333), the site API.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const here = new URL('.', import.meta.url).pathname;
export const config = Object.fromEntries(
  fs.readFileSync(here + '.env-calls', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

if (process.env.SITE) config.SITE = process.env.SITE;

// On a filtered network (TLS inspected by a firewall), SITE_TUNNEL=8443 sends the API calls through an SSH tunnel to the
// VPS (ssh -L 8443:the-ai-certification.com:443), still verified against the real certificate of the site.
import https from 'node:https';
function viaTunnel(path, init) {
  const host = new URL(config.SITE).host;
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: Number(process.env.SITE_TUNNEL), servername: host, path, method: init.method || 'GET',
      headers: { host, authorization: `Bearer ${config.CALLS_API_KEY}`, 'content-type': 'application/json' } }, (res) => {
      let data = ''; res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ ok: res.statusCode < 300, status: res.statusCode, text: async () => data, json: async () => JSON.parse(data) }));
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

export async function api(path, init = {}, retry = 4) {
  // network blips (tunnel restarting): try again a few times before giving up
  let res;
  try { res = process.env.SITE_TUNNEL
    ? await viaTunnel(path, init)
    : await fetch(config.SITE + path, { ...init, headers: { authorization: `Bearer ${config.CALLS_API_KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  } catch (e) {
    if (retry > 0) { await new Promise((r) => setTimeout(r, 5000)); return api(path, init, retry - 1); }
    throw e;
  }
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

/** Connects to the prospection Chrome, starting it (with its saved LinkedIn session) if it is not open. */
// Several LinkedIn accounts, each in its own Chrome: CDP_PORT=9333 (Pierre, default) or 9334 (Hippolyte).
export const PORT = process.env.CDP_PORT || '9333';
const PROFILE = PORT === '9333' ? `${here}chrome-profile` : `${here}compte2/chrome-profile`;
const ON_VPS = process.platform === 'linux';
export async function browser() {
  const url = `http://127.0.0.1:${PORT}`;
  const open = async () => { await fetch(`${url}/json/new?about:blank`, { method: 'PUT' }).catch(() => {}); return chromium.connectOverCDP(url); };
  try {
    return await open();
  } catch {
    if (ON_VPS) throw new Error(`Chrome ${PORT} injoignable`);
    // A normal Chrome (headless cannot read the cookies kept in the Mac keychain), launched hidden:
    // `open -g -j` starts it in the background and hidden, so no window shows up on the Mac.
    spawn('open', ['-n', '-g', ...(process.env.CHROME_VISIBLE ? [] : ['-j']), '-a', 'Google Chrome', '--args',
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,900',
      // keep working while hidden / out of sight
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ], { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try { return await open(); } catch {}
    }
    throw new Error('Chrome de prospection injoignable');
  }
}

export const pause = (min, max) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
export const log = (...a) => console.log(new Date().toISOString(), ...a);
