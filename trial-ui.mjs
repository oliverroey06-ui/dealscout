// Quick visual + interaction check of the account page trial card (Twilio on).
import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const dir = dirname(fileURLToPath(import.meta.url));
const fx = (f) => readFileSync(join(dir, 'fixtures', f), 'utf8');

const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.endsWith('/Verifications')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ status: 'pending' })); }
  if (u.pathname.endsWith('/VerificationCheck')) { let b = ''; req.on('data', c => b += c).on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: new URLSearchParams(b).get('Code') === '123456' ? 'approved' : 'denied' })); }); return; }
  res.end('ok');
});
await new Promise(r => mock.listen(0, r));
const M = `http://127.0.0.1:${mock.address().port}`;
Object.assign(process.env, { AUTH_FORCE: '1', SOURCES: 'ebay', SESSION_SECRET: 's',
  TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_VERIFY_SERVICE_SID: 'VS1', TWILIO_BASE: M });
const { buildApp } = await import('../src/server.js');
const { app } = await buildApp();
const server = app.listen(0); await new Promise(r => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
page.on('pageerror', e => errors.push(e.message));
let failed = 0; const check = (c, m) => { if (!c) { failed++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

await page.goto(base + '/signup');
await page.fill('#email', 'trial@test.com'); await page.fill('#password', 'hunter2pass');
await page.click('#submit'); await page.waitForURL('**/app');
await page.goto(base + '/account'); await page.waitForTimeout(400);
check(await page.locator('#trial-card').isVisible(), 'trial card shown for a free user (Twilio on)');
await page.screenshot({ path: '/tmp/shots/saas-5-trial.png', fullPage: true });

await page.fill('#trial-phone', '07700900123');
await page.click('#trial-send'); await page.waitForTimeout(300);
check(await page.locator('#trial-step2').isVisible(), 'code step appears after sending');
await page.fill('#trial-code', '123456');
await page.click('#trial-verify'); await page.waitForTimeout(600);
check(await page.locator('#plan-pill').innerText() === 'Pro', 'plan flips to Pro after verifying the trial');
check(await page.locator('#trial-badge').isVisible(), 'trial badge shows days left');
await page.screenshot({ path: '/tmp/shots/saas-6-trial-active.png' });

console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
console.log(failed || errors.length ? `\nTRIAL-UI FAILED` : '\nTRIAL-UI OK');
await browser.close(); server.close(); mock.close();
process.exit(failed || errors.length ? 1 : 0);
