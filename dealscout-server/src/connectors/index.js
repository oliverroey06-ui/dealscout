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
import * as aliexpress from './aliexpress.js';
import * as dhgate from './dhgate.js';
import * as alibaba from './alibaba.js';
import * as superbuy from './superbuy.js';
import * as cssbuy from './cssbuy.js';
import * as amazon from './amazon.js';

export const CONNECTORS = {
  ebay, vinted, gumtree, shpock, facebook, depop, stockx, grailed, vestiaire, preloved,
  aliexpress, dhgate, alibaba, superbuy, cssbuy, amazon,
};

// Which sources are switched on, from env. Default: core scrapers + the resale
// premium connectors. Facebook stays off (needs a logged-in browser session).
export function enabledSources(env) {
  const explicit = (env.SOURCES || '').split(',').map(s => s.trim()).filter(Boolean);
  if (explicit.length) return explicit.filter(s => CONNECTORS[s]);
  // Product default: Local resale (no eBay until API keys exist, no Facebook),
  // China = the two buying agents, Discounts = Amazon.
  const on = ['vinted', 'gumtree', 'shpock', 'depop', 'stockx', 'grailed', 'vestiaire', 'preloved',
    'superbuy', 'cssbuy', 'amazon'];
  if (env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET) on.unshift('ebay');  // returns with free API keys
  if (env.CHINA_EXTRA === '1') on.push('aliexpress', 'dhgate', 'alibaba'); // the direct-ship China trio
  if (env.FACEBOOK_ENABLED === '1') on.push('facebook');
  return on;
}

export function sourceStatus(env) {
  const on = enabledSources(env);
  const hasEbayKeys = !!(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET);
  return Object.entries(CONNECTORS).map(([id, c]) => {
    let ready = true, note = '', kind = c.meta.kind, hidden = false;
    const group = c.meta.group || 'local';
    if (id === 'ebay') {
      if (hasEbayKeys) { note = 'official API'; kind = 'api'; }
      else { note = 'scrape (add keys for API)'; kind = 'scrape'; hidden = true; } // hidden until keys exist
    }
    if (id === 'superbuy') note = 'searches Taobao via the Superbuy agent';
    if (id === 'cssbuy') { ready = false; note = 'CSSbuy’s new site requires login to search'; }
    if (id === 'amazon') note = 'discounted items only · bot-gated, best-effort';
    if (['aliexpress', 'dhgate', 'alibaba'].includes(id) && env.CHINA_EXTRA !== '1') hidden = true; // re-enable with CHINA_EXTRA=1
    if (group === 'china' && !note) note = 'ships from China · approx GBP';
    if (id === 'facebook' && env.FACEBOOK_ENABLED !== '1') { ready = false; hidden = true; note = 'needs a logged-in browser (local only)'; }
    return { id, label: c.meta.label, kind, group, ready, hidden, note, enabled: on.includes(id) };
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
