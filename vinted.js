// Vinted connector — unofficial. Vinted has no public API; the website drives
// itself through an internal JSON endpoint (/api/v2/catalog/items). We bootstrap
// an anonymous session cookie by hitting the homepage first (Vinted is behind
// Cloudflare and rejects cold API calls), then call the catalog endpoint with a
// browser-like User-Agent.
//
// This is best-effort and against Vinted's ToS. It can break when they rotate
// their anti-bot or change the JSON shape. Toggle it off if it starts failing.

import { normalize } from '../normalize.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

export const meta = { id: 'vinted', label: 'Vinted', kind: 'scrape' };

let cookieCache = { cookie: null, exp: 0 };

async function getCookie(base, signal) {
  const now = Date.now();
  if (cookieCache.cookie && now < cookieCache.exp) return cookieCache.cookie;
  const res = await fetch(base, { signal, headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
  const raw = res.headers.get('set-cookie') || '';
  // Keep the session + anti-csrf cookies the API needs.
  const cookie = raw.split(/,(?=[^;]+=[^;]+;)/).map(c => c.split(';')[0].trim())
    .filter(c => /_vinted|anon|v_udt|access_token|cf_/.test(c)).join('; ');
  cookieCache = { cookie, exp: now + 10 * 60 * 1000 };
  return cookie;
}

export async function search({ query, limit = 30, env, signal }) {
  const base = env.VINTED_BASE || 'https://www.vinted.co.uk';
  const cookie = await getCookie(base, signal);
  const url = `${base}/api/v2/catalog/items?search_text=${encodeURIComponent(query)}&per_page=${Math.min(40, limit)}&order=newest_first`;
  const res = await fetch(url, {
    signal,
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Cookie': cookie,
      'Referer': base + '/'
    }
  });
  if (!res.ok) throw new Error(`Vinted API returned ${res.status} (anti-bot or shape change)`);
  const j = await res.json();
  return mapItems(j, base);
}

function mapItems(j, base) {
  const items = j.items || [];
  return items.map((it) => {
    // price is either a string ("12.0") on older shapes or { amount, currency_code }
    let price = it.price, currency = 'GBP';
    if (price && typeof price === 'object') { currency = price.currency_code || 'GBP'; price = price.amount; }
    const url = it.url || (it.id ? `${base}/items/${it.id}` : null);
    return normalize('vinted', {
      id: it.id,
      title: [it.brand_title, it.title].filter(Boolean).join(' ') || it.title,
      rawTitle: it.title,
      url,
      image: it.photo?.url || it.photo?.thumbnails?.[0]?.url || null,
      price,
      currency,
      shipping: null,
      condition: it.status || null,
      location: null,
      seller: { name: it.user?.login || null, ratingPct: null, sales: null },
      engagement: { favourites: it.favourite_count ?? null, watchers: null },
      hasDescription: false
    });
  }).filter(Boolean);
}

export function _mapItemsForTest(json, base = 'https://www.vinted.co.uk') {
  return mapItems(json, base);
}
