// End-to-end: stand up a fake marketplace (eBay OAuth + search, Vinted, Gumtree),
// point the connectors at it, boot the real DealScout server, and run a scan
// through the whole pipeline. Proves the API contract without touching the
// internet.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const fx = (f) => readFileSync(join(dir, 'fixtures', f), 'utf8');

// --- fake marketplace host ---
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/oauth') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ access_token: 'test-token', expires_in: 7200 })); }
  if (u.pathname === '/ebay/search') { res.setHeader('content-type', 'application/json'); return res.end(fx('ebay.json')); }
  if (u.pathname.startsWith('/api/v2/catalog/items')) { res.setHeader('content-type', 'application/json'); return res.end(fx('vinted.json')); }
  if (u.pathname === '/search') { res.setHeader('content-type', 'text/html'); return res.end(fx('gumtree.html')); }
  res.setHeader('set-cookie', '_vinted_fr_session=abc; Path=/'); res.end('<html>ok</html>');
});

await new Promise(r => mock.listen(0, r));
const mp = mock.address().port;
const M = `http://127.0.0.1:${mp}`;

// point connectors at the mock, enable a subset
Object.assign(process.env, {
  PORT: '0',
  SOURCES: 'ebay,vinted,gumtree',
  EBAY_CLIENT_ID: 'id', EBAY_CLIENT_SECRET: 'secret',
  EBAY_OAUTH_URL: `${M}/oauth`, EBAY_SEARCH_URL: `${M}/ebay/search`,
  VINTED_BASE: M, GUMTREE_BASE: M
});

const { buildApp } = await import('../src/server.js');
const { app } = await buildApp();
const server = app.listen(0);
await new Promise(r => server.on('listening', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };

// /api/sources
const sources = await (await fetch(`${base}/api/sources`)).json();
check(sources.sources.length === 10, 'sources endpoint lists all 10 connectors');
check(sources.sources.find(s => s.id === 'ebay').ready === true, 'eBay reports ready when keys present');
check(sources.sources.find(s => s.id === 'facebook').ready === false, 'Facebook reports not-ready by default');

// /api/scan
const scan = await (await fetch(`${base}/api/scan?q=rtx%203080`)).json();
check(scan.ok === true, 'scan ok');
check(scan.count === 13, `scan merged 13 listings across 3 sources (got ${scan.count})`);
check(scan.sources.every(s => s.ok), 'every source returned ok envelope');
check(scan.band && scan.band.mid > 0, `value band built (mid=${scan.band?.mid})`);
check(scan.listings[0].valuation.score >= scan.listings[8].valuation.score, 'listings sorted by score desc');
const top = scan.listings[0];
check(typeof top.url === 'string' && top.url.startsWith('http'), 'top listing has a real outbound url: ' + top.url);
check(Array.isArray(top.valuation.parts) && top.valuation.parts.length === 4, 'score breakdown has 4 parts');
check(top.valuation.parts.some(p => p.measured), 'at least one measured signal');

// per-source isolation: kill vinted by pointing it at a dead path shape? Instead check a bad source name is ignored
const partial = await (await fetch(`${base}/api/scan?q=test&sources=ebay,nonsense`)).json();
check(partial.ok === true && partial.sources.length === 1, 'unknown source filtered, scan still runs');

// caching
const c1 = await (await fetch(`${base}/api/scan?q=cachetest`)).json();
const c2 = await (await fetch(`${base}/api/scan?q=cachetest`)).json();
check(c2.cached === true, 'second identical scan served from cache');

console.log(failed ? `\nINTEGRATION FAILED (${failed})` : '\nINTEGRATION OK');
server.close(); mock.close();
process.exit(failed ? 1 : 0);
