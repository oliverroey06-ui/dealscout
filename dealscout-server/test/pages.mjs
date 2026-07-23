// Browser walk-through of the SaaS pages: home -> signup -> gated app -> account.
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
  res.setHeader('set-cookie', '_v=1; Path=/'); res.end('<html>ok</html>');
});
await new Promise(r => mock.listen(0, r));
const M = `http://127.0.0.1:${mock.address().port}`;
Object.assign(process.env, { AUTH_FORCE: '1', SOURCES: 'ebay,vinted', SESSION_SECRET: 's',
  EBAY_CLIENT_ID: 'id', EBAY_CLIENT_SECRET: 's', EBAY_OAUTH_URL: `${M}/oauth`, EBAY_SEARCH_URL: `${M}/ebay/search`, VINTED_BASE: M });
const { buildApp } = await import('../src/server.js');
const { app } = await buildApp();
const server = app.listen(0);
await new Promise(r => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));
let failed = 0; const check = (c, m) => { if (!c) { failed++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// home
await page.goto(base + '/');
check(await page.locator('text=One search').first().isVisible(), 'home page renders hero');
check(await page.locator('text=£9.99').first().isVisible(), 'home shows Pro £9.99 pricing');
await page.screenshot({ path: '/tmp/shots/saas-1-home.png', fullPage: true });

// app is gated -> redirect to login
await page.goto(base + '/app');
check(page.url().endsWith('/login'), '/app redirects to /login when logged out');

// signup
await page.goto(base + '/signup');
await page.fill('#name', 'Roey');
await page.fill('#email', 'roey@example.com');
await page.fill('#password', 'hunter2pass');
await page.screenshot({ path: '/tmp/shots/saas-2-signup.png' });
await page.click('#submit');
await page.waitForURL('**/app', { timeout: 8000 });
check(page.url().endsWith('/app'), 'signup lands in the gated app');
await page.waitForTimeout(500);
check(await page.locator('#acct-chip').innerText() === 'FREE', 'app shows FREE plan chip');
check(await page.locator('text=Go Pro for unlimited').first().isVisible(), 'free-plan ads/upgrade bar shown');
await page.screenshot({ path: '/tmp/shots/saas-3-app.png' });

// run a scan
await page.fill('#q', 'rtx 3080');
await page.click('#scan');
await page.waitForSelector('#grid .deal', { timeout: 8000 });
await page.waitForTimeout(300);
const cards = await page.$$eval('#grid .deal', els => els.length);
check(cards > 0, `scan returns ${cards} listings for a logged-in user`);

// account page
await page.goto(base + '/account');
check(await page.locator('#email').innerText() === 'roey@example.com', 'account page shows email');
check(await page.locator('#billing-off').isVisible(), 'account warns billing not configured (no Stripe keys in test)');
await page.screenshot({ path: '/tmp/shots/saas-4-account.png', fullPage: true });

// logout
await page.click('#logout');
await page.waitForTimeout(400);
check(page.url().endsWith('/') || page.url().includes(base), 'logout returns to home');

console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
console.log(failed || errors.length ? `\nPAGES FAILED (${failed}, ${errors.length} errs)` : '\nPAGES OK');
await browser.close(); server.close(); mock.close();
process.exit(failed || errors.length ? 1 : 0);
