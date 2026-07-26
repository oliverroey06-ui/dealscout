// Proves scrapeFetch routes through a proxy when SCRAPER_PROXY_URL is set, and
// falls back to a direct fetch otherwise. Uses a tiny local forward proxy that
// handles both absolute-form requests and CONNECT tunnels, so it's fully offline.
import http from 'node:http';
import net from 'node:net';
import { scrapeFetch, proxyEnabled, proxyDispatcher } from '../src/net.js';

// --- target origin ---
const target = http.createServer((req, res) => { res.setHeader('content-type', 'text/plain'); res.end('TARGET-OK'); });
await new Promise(r => target.listen(0, '127.0.0.1', r));
const targetUrl = `http://127.0.0.1:${target.address().port}/hi`;

// --- minimal forward proxy that counts everything it brokers ---
let brokered = 0;
const proxy = http.createServer((req, res) => {                 // absolute-form http proxying
  brokered++;
  let u; try { u = new URL(req.url); } catch { res.writeHead(400); return res.end('bad'); }
  const p = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: req.method, headers: req.headers },
    pr => { res.writeHead(pr.statusCode || 502, pr.headers); pr.pipe(res); });
  p.on('error', () => { res.writeHead(502); res.end('proxy-err'); });
  req.pipe(p);
});
proxy.on('connect', (req, client, head) => {                    // CONNECT tunnel
  brokered++;
  const [host, port] = req.url.split(':');
  const up = net.connect(Number(port) || 80, host, () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) up.write(head);
    up.pipe(client); client.pipe(up);
  });
  up.on('error', () => client.end());
});
await new Promise(r => proxy.listen(0, '127.0.0.1', r));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;

let fail = 0; const ck = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// 1) no proxy -> direct, proxy never touched
ck(proxyEnabled({}) === false, 'proxyEnabled false with empty env');
ck(proxyDispatcher({}) === null, 'no dispatcher with empty env');
const d = await scrapeFetch(targetUrl, {}, {});
ck((await d.text()) === 'TARGET-OK' && brokered === 0, 'direct fetch works, proxy untouched');

// 2) proxy set -> routed through it
const env = { SCRAPER_PROXY_URL: proxyUrl };
ck(proxyEnabled(env) === true, 'proxyEnabled true when SCRAPER_PROXY_URL set');
ck(proxyDispatcher(env) !== null, 'dispatcher built when proxy set');
const before = brokered;
const p = await scrapeFetch(targetUrl, {}, env);
ck((await p.text()) === 'TARGET-OK', 'proxied fetch still returns the body');
ck(brokered > before, `request went through the proxy (brokered ${before} -> ${brokered})`);

// 3) inline user:pass@ credentials parse without throwing
ck(proxyDispatcher({ SCRAPER_PROXY_URL: 'http://user:pass@127.0.0.1:9' }) !== null, 'inline user:pass@ proxy url builds an agent');

console.log(fail ? `\nPROXY FAILED (${fail})` : '\nPROXY OK');
target.close(); proxy.close();
process.exit(fail ? 1 : 0);
