import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const fx = (f) => readFileSync(join(dir, 'fixtures', f), 'utf8');

const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/oauth') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ access_token: 't', expires_in: 7200 })); }
  if (u.pathname === '/ebay/search') { res.setHeader('content-type', 'application/json'); return res.end(fx('ebay.json')); }
  if (u.pathname.startsWith('/api/v2/catalog/items')) { res.setHeader('content-type', 'application/json'); return res.end(fx('vinted.json')); }
  if (u.pathname === '/search') { res.setHeader('content-type', 'text/html'); return res.end(fx('gumtree.html')); }
  res.setHeader('set-cookie', '_vinted_fr_session=abc; Path=/'); res.end('<html>ok</html>');
});
await new Promise(r => mock.listen(0, r));
const M = `http://127.0.0.1:${mock.address().port}`;
Object.assign(process.env, {
  PORT: '0', SOURCES: 'ebay,vinted,gumtree',
  EBAY_CLIENT_ID: 'id', EBAY_CLIENT_SECRET: 's',
  EBAY_OAUTH_URL: `${M}/oauth`, EBAY_SEARCH_URL: `${M}/ebay/search`,
  VINTED_BASE: M, GUMTREE_BASE: M
});
const { buildApp } = await import('../src/server.js');
const { app } = await buildApp();
const server = app.listen(0);
await new Promise(r => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
// Ignore environmental resource-load failures (the fixtures point image src at
// real marketplace hosts this sandbox can't reach; onerror removes them). We
// only care about real JS/page errors.
const envNoise = (t) => /ERR_TUNNEL_CONNECTION_FAILED|Failed to load resource|net::ERR_/.test(t);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', m => { if (m.type() === 'error' && !envNoise(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));

await page.goto(base);
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/shots/srv-1-home.png' });

// source chips loaded?
const chips = await page.$$eval('#sourcerow .src', els => els.map(e => ({ label: e.textContent.trim(), on: e.classList.contains('on') })));
console.log('SOURCE CHIPS:', JSON.stringify(chips));

// run a scan
await page.fill('#q', 'rtx 3080');
await page.click('#scan');
await page.waitForSelector('#grid .deal', { timeout: 8000 });
await page.waitForTimeout(400);
const cards = await page.$$eval('#grid .deal', els => els.length);
const top = await page.$eval('#grid .deal', el => ({
  title: el.querySelector('.title').textContent,
  price: el.querySelector('.price').textContent,
  score: el.querySelector('.dial .n').textContent,
  src: el.querySelector('.badge-src').textContent,
  viewHref: el.querySelector('.viewsrc').href
}));
console.log('CARDS:', cards, 'TOP:', JSON.stringify(top));
await page.screenshot({ path: '/tmp/shots/srv-2-results.png' });

// drawer
await page.click('#grid .deal');
await page.waitForTimeout(400);
const drawer = await page.$eval('#dbody', el => ({
  parts: el.querySelectorAll('.brk').length,
  compLinks: el.querySelectorAll('.comps a').length,
  openHref: (el.querySelector('.dact a') || {}).href,
  band: !!el.querySelector('.vtrack')
}));
console.log('DRAWER:', JSON.stringify(drawer));
await page.screenshot({ path: '/tmp/shots/srv-3-drawer.png' });
await page.keyboard.press('Escape');

// watch
await page.click('#grid [data-w]');
await page.waitForTimeout(200);
const wc = await page.$eval('#watch-count', el => el.textContent);
console.log('WATCH COUNT:', wc);

// filter by score
await page.$eval('#fscore', el => { el.value = 80; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(200);
const afterFilter = await page.$$eval('#grid .deal', els => els.length);
console.log('CARDS after score>=80 filter:', afterFilter);
await page.screenshot({ path: '/tmp/shots/srv-4-filtered.png' });

// mobile
const mp = await browser.newPage({ viewport: { width: 390, height: 844 } });
mp.on('pageerror', e => errors.push('M PAGEERR: ' + e.message));
await mp.goto(base);
await mp.fill('#q', 'rtx 3080');
await mp.click('#scan');
await mp.waitForSelector('#grid .deal', { timeout: 8000 });
await mp.waitForTimeout(300);
await mp.screenshot({ path: '/tmp/shots/srv-5-mobile.png', fullPage: true });

console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close(); server.close(); mock.close();
process.exit(errors.length ? 1 : 0);
