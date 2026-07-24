// DealScout server — genuine-resale deal scanner + accounts, tiers and gating.
//
// Two modes, chosen automatically:
//   • OPEN mode  (no DATABASE_URL / AUTH_FORCE) — the public scanner, no login.
//     Keeps the current live site working until the database is wired up.
//   • SAAS mode  (DATABASE_URL or AUTH_FORCE=1) — public home page, accounts
//     required, per-plan limits enforced, Stripe billing.

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { enabledSources, sourceStatus, runSource } from './connectors/index.js';
import { scoreScan } from './valuation.js';
import { TTLCache } from './cache.js';
import { createStore } from './store.js';
import { PLANS, planOf, allowedSources, isPremiumSource, activePlanId, onTrial, TRIAL } from './plans.js';
import * as auth from './auth.js';
import * as billing from './billing.js';
import * as verify from './verify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUB = join(__dirname, '..', 'public');
const env = process.env;
const AUTH_ENABLED = !!(env.DATABASE_URL || env.AUTH_FORCE);
const dayKey = () => new Date(Number(env.NOW_MS) || Date.now()).toISOString().slice(0, 10);
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const origin = (req) => `${req.protocol}://${req.get('host')}`;

export async function buildApp() {
  const store = await createStore(env);
  const cache = new TTLCache(Number(env.CACHE_TTL_MS || 90_000));
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Stripe webhook needs the raw body for signature verification — mount it
  // BEFORE the JSON parser so express.json() doesn't consume the stream.
  app.post('/api/stripe/webhook', express.raw({ type: '*/*' }), async (req, res) => {
    if (!billing.billingConfigured(env)) return res.status(400).end();
    try {
      const status = await billing.handleWebhook(env, store, req.body, req.headers['stripe-signature']);
      res.json({ received: true, status });
    } catch (e) { console.error('stripe webhook error:', e.message); res.status(400).send(`webhook error`); }
  });

  app.use(express.json());
  app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
  app.use(auth.attachUser(store, env));

  const publicUser = (u) => u && ({
    email: u.email, name: u.name,
    plan: activePlanId(u),          // the tier they effectively have right now
    basePlan: u.plan,               // their paid subscription tier
    onTrial: onTrial(u),
    trialEndsAt: u.trialEndsAt,
    subscriptionStatus: u.subscriptionStatus,
    currentPeriodEnd: u.currentPeriodEnd,
  });

  // ---------------- meta ----------------
  app.get('/api/config', (req, res) => res.json({
    authEnabled: AUTH_ENABLED, googleEnabled: auth.googleConfigured(env),
    billingEnabled: billing.billingConfigured(env),
    trialEnabled: verify.verifyConfigured(env), trialDays: TRIAL.days,
    user: publicUser(req.user),
  }));
  app.get('/api/plans', (_req, res) => res.json({ plans: PLANS }));
  app.get('/api/sources', (req, res) => {
    const plan = planOf(activePlanId(req.user));
    res.json({ sources: sourceStatus(env).map(s => {
      const premium = isPremiumSource(s.id);
      return { ...s, tier: premium ? 'premium' : 'core', premiumLocked: AUTH_ENABLED && plan.sources !== 'all' && premium };
    }) });
  });
  app.get('/api/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    res.json({ user: publicUser(req.user) });
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true, mode: AUTH_ENABLED ? 'saas' : 'open', store: store.kind, uptime: process.uptime() }));

  // ---------------- auth ----------------
  app.post('/api/auth/signup', async (req, res) => {
    if (!AUTH_ENABLED) return res.status(400).json({ ok: false, error: 'Accounts are not enabled' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim() || null;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ ok: false, error: 'Enter a valid email' });
    if (password.length < 8) return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
    if (await store.users.byEmail(email)) return res.status(409).json({ ok: false, error: 'An account with that email already exists' });
    const user = await store.users.create({ email, name, passwordHash: auth.hashPassword(password), plan: 'free' });
    auth.setSessionCookie(res, env, user.id);
    res.json({ ok: true, user: publicUser(user) });
  });

  app.post('/api/auth/login', async (req, res) => {
    if (!AUTH_ENABLED) return res.status(400).json({ ok: false, error: 'Accounts are not enabled' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = await store.users.byEmail(email);
    if (!user || !auth.verifyPassword(password, user.passwordHash)) return res.status(401).json({ ok: false, error: 'Wrong email or password' });
    auth.setSessionCookie(res, env, user.id);
    res.json({ ok: true, user: publicUser(user) });
  });

  app.post('/api/auth/logout', (_req, res) => { auth.clearSessionCookie(res); res.json({ ok: true }); });

  // ---------------- billing ----------------
  app.post('/api/billing/checkout', auth.requireUser, async (req, res) => {
    if (!billing.billingConfigured(env)) return res.status(400).json({ ok: false, code: 'billing_off', error: 'Billing isn’t switched on yet.' });
    const planId = String(req.body?.plan || '');
    if (!['pro', 'elite'].includes(planId)) return res.status(400).json({ ok: false, error: 'Choose Pro or Elite' });
    try { res.json({ ok: true, url: await billing.createCheckout(env, store, req.user, planId, origin(req)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/billing/portal', auth.requireUser, async (req, res) => {
    if (!billing.billingConfigured(env)) return res.status(400).json({ ok: false, code: 'billing_off', error: 'Billing isn’t switched on yet.' });
    try { res.json({ ok: true, url: await billing.createPortal(env, store, req.user, origin(req)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ---------------- phone-verified free trial ----------------
  app.post('/api/trial/send', auth.requireUser, async (req, res) => {
    if (!verify.verifyConfigured(env)) return res.status(400).json({ ok: false, code: 'trial_off', error: 'Phone trials aren’t switched on for this site yet.' });
    if (onTrial(req.user) || ['active', 'past_due'].includes(req.user.subscriptionStatus)) return res.status(400).json({ ok: false, error: 'You already have an active plan or trial.' });
    const e164 = verify.normalizePhone(req.body?.phone);
    if (!e164 || e164.replace(/\D/g, '').length < 8) return res.status(400).json({ ok: false, error: 'Enter a valid mobile number.' });
    if (await store.trials.usedByPhone(verify.phoneHash(e164))) return res.status(409).json({ ok: false, code: 'trial_used', error: 'A free trial has already been claimed for that number.' });
    try { await verify.sendCode(env, e164); res.json({ ok: true }); }
    catch (e) { res.status(502).json({ ok: false, error: 'Couldn’t text that number. Check it and try again.' }); }
  });
  app.post('/api/trial/verify', auth.requireUser, async (req, res) => {
    if (!verify.verifyConfigured(env)) return res.status(400).json({ ok: false, code: 'trial_off', error: 'Phone trials aren’t switched on yet.' });
    const e164 = verify.normalizePhone(req.body?.phone), code = String(req.body?.code || '').trim();
    if (!e164 || !code) return res.status(400).json({ ok: false, error: 'Missing phone or code' });
    const hash = verify.phoneHash(e164);
    if (await store.trials.usedByPhone(hash)) return res.status(409).json({ ok: false, code: 'trial_used', error: 'That number’s trial has already been used.' });
    const { approved } = await verify.checkCode(env, e164, code);
    if (!approved) return res.status(400).json({ ok: false, error: 'That code isn’t right — try again.' });
    await store.trials.markUsed(hash, req.user.id);
    const trialEndsAt = Date.now() + TRIAL.days * 864e5;
    await store.users.update(req.user.id, { trialEndsAt, phoneHash: hash });
    res.json({ ok: true, plan: TRIAL.plan, trialEndsAt });
  });

  // Google OAuth
  const googleStates = new Set();
  app.get('/api/auth/google', (req, res) => {
    if (!auth.googleConfigured(env)) return res.status(400).send('Google sign-in not configured');
    const state = auth.newState(); googleStates.add(state);
    setTimeout(() => googleStates.delete(state), 10 * 60 * 1000);
    res.redirect(auth.googleAuthUrl(env, origin(req), state));
  });
  app.get('/api/auth/google/callback', async (req, res) => {
    try {
      if (!googleStates.delete(String(req.query.state))) return res.redirect('/login?error=google_state');
      const g = await auth.googleExchange(env, origin(req), String(req.query.code));
      let user = await store.users.byGoogleId(g.googleId) || (g.email && await store.users.byEmail(g.email));
      if (user) { if (!user.googleId) user = await store.users.update(user.id, { googleId: g.googleId }); }
      else user = await store.users.create({ email: g.email, name: g.name, googleId: g.googleId, plan: 'free' });
      auth.setSessionCookie(res, env, user.id);
      res.redirect('/app');
    } catch (e) { res.redirect('/login?error=google'); }
  });

  // ---------------- watchlist (persisted, plan-limited) ----------------
  app.get('/api/watchlist', auth.requireUser, async (req, res) => res.json({ items: await store.watchlist.list(req.user.id) }));
  app.post('/api/watchlist', auth.requireUser, async (req, res) => {
    const item = req.body?.item;
    if (!item?.id) return res.status(400).json({ ok: false, error: 'Missing item' });
    const plan = planOf(activePlanId(req.user));
    const count = await store.watchlist.count(req.user.id);
    const existing = (await store.watchlist.list(req.user.id)).some(w => w.id === item.id);
    if (!existing && count >= plan.watchlist) return res.status(402).json({ ok: false, code: 'limit_watchlist', error: `Your plan tracks up to ${plan.watchlist} items. Upgrade for more.` });
    await store.watchlist.add(req.user.id, item, req.body?.targetPrice ?? null);
    res.json({ ok: true });
  });
  app.delete('/api/watchlist/:id', auth.requireUser, async (req, res) => { await store.watchlist.remove(req.user.id, req.params.id); res.json({ ok: true }); });

  // ---------------- saved searches (persisted, plan-limited) ----------------
  app.get('/api/saved-searches', auth.requireUser, async (req, res) => res.json({ searches: await store.savedSearches.list(req.user.id) }));
  app.post('/api/saved-searches', auth.requireUser, async (req, res) => {
    const query = String(req.body?.query || '').trim();
    if (!query) return res.status(400).json({ ok: false, error: 'Missing query' });
    const plan = planOf(activePlanId(req.user));
    if (await store.savedSearches.count(req.user.id) >= plan.savedSearches) return res.status(402).json({ ok: false, code: 'limit_searches', error: `Your plan saves up to ${plan.savedSearches} searches. Upgrade for more.` });
    const row = await store.savedSearches.add(req.user.id, { query, sources: req.body?.sources || [], filters: req.body?.filters || {} });
    res.json({ ok: true, search: row });
  });
  app.delete('/api/saved-searches/:id', auth.requireUser, async (req, res) => { await store.savedSearches.remove(req.user.id, req.params.id); res.json({ ok: true }); });

  // ---------------- scan ----------------
  app.get('/api/scan', async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) return res.status(400).json({ ok: false, error: 'Missing q' });

    let plan = planOf('free'), day = dayKey(), user = req.user;
    if (AUTH_ENABLED) {
      if (!user) return res.status(401).json({ ok: false, error: 'Sign in to scan', code: 'auth_required' });
      plan = planOf(activePlanId(user));
      if (plan.scoresPerDay !== Infinity) {
        const used = await store.usage.get(user.id, day);
        if (used >= plan.scoresPerDay) return res.status(402).json({ ok: false, code: 'limit_scans', error: `The Free plan is ${plan.scoresPerDay} scans a day. Upgrade for unlimited.` });
      }
    }

    const limit = Math.min(50, Math.max(5, Number(req.query.limit) || 30));
    const allEnabled = enabledSources(env);
    const permitted = AUTH_ENABLED ? allowedSources(plan.id, allEnabled) : allEnabled;
    const requested = String(req.query.sources || '').split(',').map(s => s.trim()).filter(Boolean);
    let sources = requested.length ? requested.filter(s => permitted.includes(s)) : permitted;
    const blockedPremium = requested.filter(s => allEnabled.includes(s) && !permitted.includes(s));
    if (!sources.length) return res.status(400).json({ ok: false, error: blockedPremium.length ? 'Those sources need a higher plan' : 'No sources selected', code: blockedPremium.length ? 'limit_source' : 'no_sources' });

    const cacheKey = `${query}::${sources.join(',')}::${limit}`;
    const cached = cache.get(cacheKey);
    let payload = cached && !req.query.fresh ? { ...cached, cached: true } : null;
    if (!payload) {
      const started = Date.now();
      const results = await Promise.all(sources.map(id => runSource(id, { query, limit, env })));
      const scored = scoreScan(results.flatMap(r => r.listings)).sort((a, b) => b.valuation.score - a.valuation.score);
      payload = {
        ok: true, query, ms: Date.now() - started,
        sources: results.map(r => ({ source: r.source, ok: r.ok, count: r.listings.length, ms: r.ms, error: r.error || null })),
        band: scored[0]?.valuation.band || null, count: scored.length, listings: scored,
      };
      cache.set(cacheKey, payload);
    }
    if (AUTH_ENABLED && plan.scoresPerDay !== Infinity) {
      const n = await store.usage.bump(user.id, day);
      payload.scansToday = n; payload.scansPerDay = plan.scoresPerDay;
    }
    if (blockedPremium.length) payload.blockedPremium = blockedPremium;
    payload.plan = plan.id; payload.ads = AUTH_ENABLED ? plan.ads : false;
    res.json(payload);
  });

  // ---------------- pages ----------------
  const page = (file) => (_req, res) => res.sendFile(join(PUB, file));
  if (AUTH_ENABLED) {
    app.get('/', page('home.html'));
    app.get('/login', page('auth.html'));
    app.get('/signup', page('auth.html'));
    app.get('/pricing', page('home.html'));
    app.get('/app', (req, res) => req.user ? res.sendFile(join(PUB, 'index.html')) : res.redirect('/login'));
    app.get('/account', (req, res) => req.user ? res.sendFile(join(PUB, 'account.html')) : res.redirect('/login'));
  } else {
    app.get('/', page('index.html')); // open mode: scanner is the front door
  }
  app.use(express.static(PUB, { extensions: ['html'], index: false }));
  app.get('*', (req, res) => {
    if (AUTH_ENABLED) return res.redirect(req.user ? '/app' : '/');
    res.sendFile(join(PUB, 'index.html'));
  });

  return { app, store };
}

// ---------------- boot ----------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const { app } = await buildApp();
  const port = Number(env.PORT || 8080);
  app.listen(port, () => {
    console.log(`\n  DealScout running → http://localhost:${port}`);
    console.log(`  Mode: ${AUTH_ENABLED ? 'SAAS (accounts required)' : 'OPEN (no accounts yet)'}`);
    console.log(`  Sources enabled: ${enabledSources(env).join(', ')}`);
    if (AUTH_ENABLED && !env.DATABASE_URL) console.log('  ⚠ AUTH_FORCE on with in-memory store — accounts reset on restart. Set DATABASE_URL for persistence.');
    if (!(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET)) console.log('  · eBay: scrape mode (add EBAY_CLIENT_ID/SECRET for the official API).');
    console.log('');
  });
}
