// Connector registry + per-source availability. Each connector exports
// { meta, search({query, limit, env, signal}) }. Failures are isolated: one
// dead source never breaks a scan.

import * as ebay from './ebay.js';
import * as vinted from './vinted.js';
import * as gumtree from './gumtree.js';
import * as shpock from './shpock.js';
import * as facebook from './facebook.js';
import * as depop from './depop.js';
import * as stockx from './stockx.js';
import * as grailed from './grailed.js';
import * as vestiaire from './vestiaire.js';
import * as preloved from './preloved.js';

export const CONNECTORS = { ebay, vinted, gumtree, shpock, facebook, depop, stockx, grailed, vestiaire, preloved };

// Which sources are switched on, from env. Default: core scrapers + the resale
// premium connectors. Facebook stays off (needs a logged-in browser session).
export function enabledSources(env) {
  const explicit = (env.SOURCES || '').split(',').map(s => s.trim()).filter(Boolean);
  if (explicit.length) return explicit.filter(s => CONNECTORS[s]);
  const on = ['ebay', 'vinted', 'gumtree', 'shpock', 'depop', 'stockx', 'grailed', 'vestiaire', 'preloved'];
  if (env.FACEBOOK_ENABLED === '1') on.push('facebook');
  return on;
}

export function sourceStatus(env) {
  return Object.entries(CONNECTORS).map(([id, c]) => {
    let ready = true, note = '', kind = c.meta.kind;
    if (id === 'ebay') {
      // eBay is always usable now: official API when keys are set, scrape otherwise.
      if (env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET) { note = 'official API'; kind = 'api'; }
      else { note = 'scrape (add keys for API)'; kind = 'scrape'; }
    }
    if (id === 'facebook' && env.FACEBOOK_ENABLED !== '1') { ready = false; note = 'needs a logged-in browser (local only)'; }
    return { id, label: c.meta.label, kind, ready, note, enabled: enabledSources(env).includes(id) };
  });
}

// Run one source with a timeout; never throw — return a result envelope.
export async function runSource(id, { query, limit, env }) {
  const c = CONNECTORS[id];
  if (!c) return { source: id, ok: false, error: 'unknown source', listings: [] };
  const ctrl = new AbortController();
  const timeout = Number(env.SCAN_TIMEOUT_MS || 12000);
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const t0 = Date.now();
  try {
    const listings = await c.search({ query, limit, env, signal: ctrl.signal });
    return { source: id, ok: true, ms: Date.now() - t0, listings: listings || [] };
  } catch (err) {
    return { source: id, ok: false, ms: Date.now() - t0, error: String(err.message || err), listings: [] };
  } finally {
    clearTimeout(timer);
  }
}
