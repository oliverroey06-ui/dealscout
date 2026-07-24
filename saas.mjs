// SaaS mode: accounts required, per-plan gating. Runs on the in-memory store
// (AUTH_FORCE=1) against a mock marketplace so it's fully offline.
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
  // mock Twilio Verify
  if (u.pathname.endsWith('/Verifications')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ status: 'pending' })); }
  if (u.pathname.endsWith('/VerificationCheck')) {
    let b = ''; req.on('data', c => b += c).on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: new URLSearchParams(b).get('Code') === '123456' ? 'approved' : 'denied' })); });
    return;
  }
  res.setHeader('set-cookie', '_vinted_fr_session=abc; Path=/'); res.end('<html>ok</html>');
});
await new Promise(r => mock.listen(0, r));
const M = `http://127.0.0.1:${mock.address().port}`;
Object.assign(process.env, {
  AUTH_FORCE: '1', SOURCES: 'ebay,vinted',
  EBAY_CLIENT_ID: 'id', EBAY_CLIENT_SECRET: 's', EBAY_OAUTH_URL: `${M}/oauth`, EBAY_SEARCH_URL: `${M}/ebay/search`,
  VINTED_BASE: M, SESSION_SECRET: 'test-secret',
  TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_VERIFY_SERVICE_SID: 'VS1', TWILIO_BASE: M,
});

const { buildApp } = await import('../src/server.js');
const { app } = await buildApp();
const server = app.listen(0);
await new Promise(r => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

let failed = 0, cookie = '';
const check = (c, m) => { if (!c) { failed++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const call = async (path, opts = {}) => {
  const res = await fetch(base + path, { ...opts, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers || {}) }, redirect: 'manual' });
  const sc = res.headers.get('set-cookie'); if (sc && sc.includes('ds_session=')) cookie = sc.split(';')[0];
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};

// config: auth on, no user
check((await call('/api/config')).body.authEnabled === true, 'config reports authEnabled');

// scan blocked when logged out
check((await call('/api/scan?q=rtx')).status === 401, 'scan blocked when logged out (401)');

// signup validation
check((await call('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email: 'bad', password: 'x' }) })).status === 400, 'signup rejects bad email/short password');

// signup ok -> cookie
const su = await call('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email: 'roey@test.com', password: 'hunter2pass', name: 'Roey' }) });
check(su.status === 200 && su.body.user.email === 'roey@test.com' && su.body.user.plan === 'free', 'signup creates a free account + session');
check(!!cookie, 'session cookie set');

// duplicate email
const dup = await call('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email: 'roey@test.com', password: 'anotherpass1' }) });
check(dup.status === 409, 'duplicate email rejected (409)');

// me
check((await call('/api/me')).body.user.email === 'roey@test.com', '/api/me returns the logged-in user');

// scan now works
const scan = await call('/api/scan?q=rtx%203080');
check(scan.status === 200 && scan.body.count > 0, 'scan works when logged in');
check(scan.body.plan === 'free' && scan.body.ads === true, 'free plan flagged with ads on');

// watchlist free limit = 5
for (let i = 1; i <= 5; i++) await call('/api/watchlist', { method: 'POST', body: JSON.stringify({ item: { id: 'w' + i, title: 'x', price: 1 } }) });
const sixth = await call('/api/watchlist', { method: 'POST', body: JSON.stringify({ item: { id: 'w6', title: 'x', price: 1 } }) });
check(sixth.status === 402 && sixth.body.code === 'limit_watchlist', 'watchlist capped at 5 on free (6th → 402)');
check((await call('/api/watchlist')).body.items.length === 5, 'watchlist persists 5 items');

// saved searches free limit = 3
for (let i = 1; i <= 3; i++) await call('/api/saved-searches', { method: 'POST', body: JSON.stringify({ query: 'q' + i }) });
const fourth = await call('/api/saved-searches', { method: 'POST', body: JSON.stringify({ query: 'q4' }) });
check(fourth.status === 402 && fourth.body.code === 'limit_searches', 'saved searches capped at 3 on free (4th → 402)');

// scans/day free limit = 10 (we already used 1)
for (let i = 2; i <= 10; i++) await call('/api/scan?q=rtx&fresh=1');
const over = await call('/api/scan?q=rtx&fresh=1');
check(over.status === 402 && over.body.code === 'limit_scans', 'scans/day capped at 10 on free (11th → 402)');

// phone-verified trial lifts the plan
check((await call('/api/trial/send', { method: 'POST', body: JSON.stringify({ phone: '07700900123' }) })).status === 200, 'trial: OTP sent');
check((await call('/api/trial/verify', { method: 'POST', body: JSON.stringify({ phone: '07700900123', code: '000000' }) })).status === 400, 'trial: wrong code rejected');
const grant = await call('/api/trial/verify', { method: 'POST', body: JSON.stringify({ phone: '07700900123', code: '123456' }) });
check(grant.status === 200 && grant.body.plan === 'pro', 'trial: correct code grants a Pro trial');
const meT = (await call('/api/me')).body.user;
check(meT.plan === 'pro' && meT.onTrial === true, 'me now shows Pro (on trial)');
check((await call('/api/scan?q=rtx&fresh=1')).status === 200, 'trial lifts the 10-scans/day cap');
check((await call('/api/watchlist', { method: 'POST', body: JSON.stringify({ item: { id: 'w6', title: 'x', price: 1 } }) })).status === 200, 'trial lifts the 5-item watchlist cap');

// the same phone number cannot claim a second trial (new account)
cookie = '';
await call('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email: 'two@test.com', password: 'hunter2pass' }) });
const reuse = await call('/api/trial/send', { method: 'POST', body: JSON.stringify({ phone: '07700 900 123' }) });
check(reuse.status === 409 && reuse.body.code === 'trial_used', 'same phone number can’t claim a second trial');

// logout
await call('/api/auth/logout', { method: 'POST' }); cookie = '';
check((await call('/api/me')).body.user === null, 'logout clears the session');

console.log(failed ? `\nSAAS FAILED (${failed})` : '\nSAAS OK');
server.close(); mock.close();
process.exit(failed ? 1 : 0);
