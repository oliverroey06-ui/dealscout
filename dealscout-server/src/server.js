// DealScout server — Express app: serves the scanner UI and the /api endpoints
// that fan a query out across the enabled marketplace connectors, score the
// combined results against a live value band, and return them.

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { enabledSources, sourceStatus, runSource } from './connectors/index.js';
import { scoreScan } from './valuation.js';
import { TTLCache } from './cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const app = express();
const cache = new TTLCache(Number(env.CACHE_TTL_MS || 90_000));

app.disable('x-powered-by');
app.use(express.json());

// --- security + CORS (same-origin UI; APIs are read-only) ---
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// --- API: which sources exist and whether they're ready ---
app.get('/api/sources', (_req, res) => {
  res.json({ sources: sourceStatus(env) });
});

// --- API: scan ---
// GET /api/scan?q=rtx%203080&sources=ebay,vinted&limit=30
app.get('/api/scan', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return res.status(400).json({ ok: false, error: 'Missing q' });
  const limit = Math.min(50, Math.max(5, Number(req.query.limit) || 30));
  const requested = String(req.query.sources || '').split(',').map(s => s.trim()).filter(Boolean);
  const allEnabled = enabledSources(env);
  const sources = requested.length ? requested.filter(s => allEnabled.includes(s)) : allEnabled;
  if (!sources.length) return res.status(400).json({ ok: false, error: 'No enabled sources selected' });

  const cacheKey = `${query}::${sources.join(',')}::${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && !req.query.fresh) return res.json({ ...cached, cached: true });

  const started = Date.now();
  const results = await Promise.all(sources.map(id => runSource(id, { query, limit, env })));

  const listings = results.flatMap(r => r.listings);
  const scored = scoreScan(listings).sort((a, b) => b.valuation.score - a.valuation.score);

  const payload = {
    ok: true,
    query,
    ms: Date.now() - started,
    sources: results.map(r => ({ source: r.source, ok: r.ok, count: r.listings.length, ms: r.ms, error: r.error || null })),
    band: scored[0]?.valuation.band || null,
    count: scored.length,
    listings: scored
  };
  cache.set(cacheKey, payload);
  res.json(payload);
});

app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

// --- static UI ---
app.use(express.static(join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(join(__dirname, '..', 'public', 'index.html')));

const port = Number(env.PORT || 8080);
app.listen(port, () => {
  const on = enabledSources(env);
  console.log(`\n  DealScout running → http://localhost:${port}`);
  console.log(`  Sources enabled: ${on.join(', ')}`);
  if (!(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET)) {
    console.log('  ⚠ eBay keys missing — add EBAY_CLIENT_ID / EBAY_CLIENT_SECRET to .env for the reliable source.');
  }
  console.log('');
});

export { app };
