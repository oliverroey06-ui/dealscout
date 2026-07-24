// Authentication: password hashing, signed session cookies, Google OAuth,
// and Express middleware. No third-party auth libs — Node's crypto only.

import { scryptSync, randomBytes, timingSafeEqual, createHmac, randomUUID } from 'node:crypto';

const COOKIE = 'ds_session';
const SESSION_DAYS = 30;

// --- passwords (scrypt) ---
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const hash = Buffer.from(hashHex, 'hex');
  const test = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return hash.length === test.length && timingSafeEqual(hash, test);
}

// --- signed session cookie (stateless) ---
function secret(env) {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  // Dev fallback: a per-boot secret. Sessions won't survive a restart, and we
  // warn loudly. Production MUST set SESSION_SECRET.
  if (!globalThis.__ds_dev_secret) {
    globalThis.__ds_dev_secret = randomBytes(32).toString('hex');
    console.warn('  ⚠ SESSION_SECRET not set — using a temporary secret (sessions reset on restart).');
  }
  return globalThis.__ds_dev_secret;
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');

export function makeSession(env, userId) {
  const payload = b64u(JSON.stringify({ uid: userId, iat: Date.now() }));
  const sig = createHmac('sha256', secret(env)).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function readSession(env, token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = createHmac('sha256', secret(env)).update(payload).digest('base64url');
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { uid, iat } = JSON.parse(unb64u(payload).toString());
    if (!uid || Date.now() - iat > SESSION_DAYS * 864e5) return null;
    return uid;
  } catch { return null; }
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
export function setSessionCookie(res, env, userId) {
  const secure = env.HF_ENV === 'production' || env.NODE_ENV === 'production' || env.RENDER === 'true';
  res.setHeader('Set-Cookie', `${COOKIE}=${makeSession(env, userId)}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax${secure ? '; Secure' : ''}`);
}
export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

// --- middleware ---
// attachUser loads req.user (or null) from the cookie on every request.
export function attachUser(store, env) {
  return async (req, _res, next) => {
    req.user = null;
    try {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      const uid = readSession(env, token);
      if (uid) req.user = await store.users.byId(uid);
    } catch { /* ignore */ }
    next();
  };
}
// requireUser guards API routes (401) — page routes redirect to /login instead.
export function requireUser(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ ok: false, error: 'Sign in required', code: 'auth_required' });
}

// --- Google OAuth (Authorization Code flow) ---
export function googleConfigured(env) { return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET); }
export function googleAuthUrl(env, origin, state) {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}
export async function googleExchange(env, origin, code) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      code, grant_type: 'authorization_code', redirect_uri: `${origin}/api/auth/google/callback`,
    }),
  });
  if (!tokenRes.ok) throw new Error('Google token exchange failed');
  const { access_token } = await tokenRes.json();
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${access_token}` } });
  if (!infoRes.ok) throw new Error('Google userinfo failed');
  const info = await infoRes.json();
  return { googleId: info.sub, email: info.email, name: info.name || info.given_name || null };
}

export function newState() { return randomUUID(); }
