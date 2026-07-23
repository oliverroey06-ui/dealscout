// StockX connector — unofficial. StockX exposes a browse JSON endpoint the site
// uses; it is aggressively bot-protected (expect blocks from datacenter IPs),
// so treat as best-effort. Prices use the current lowest ask.

import { normalize, parseMoney } from '../normalize.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
export const meta = { id: 'stockx', label: 'StockX', kind: 'scrape' };

export async function search({ query, limit = 30, env, signal }) {
  const base = env.STOCKX_BASE || 'https://stockx.com';
  const url = `${base}/api/browse?_search=${encodeURIComponent(query)}&page=1`;
  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': base + '/', 'app-platform': 'Iron', 'x-requested-with': 'XMLHttpRequest' },
  });
  if (!res.ok) throw new Error(`StockX returned ${res.status} (bot-protected — usually needs a residential IP or official API)`);
  return parse(await res.json(), base).slice(0, limit);
}

export function parse(json, base = 'https://stockx.com') {
  const arr = json.Products || json.products || json.hits || [];
  return arr.map((p) => {
    const market = p.market || {};
    const amount = market.lowestAsk ?? market.lowestAskAmount ?? p.lowestAsk ?? p.retailPrice;
    const currency = (market.currencyCode || p.currencyCode || 'GBP').toUpperCase().slice(0, 3);
    const key = p.urlKey || p.slug || p.id;
    return normalize('stockx', {
      id: p.id || key,
      title: [p.brand, p.title || p.name].filter(Boolean).join(' ').slice(0, 120) || String(key),
      url: key ? `${base}/${key}` : null,
      image: p.media?.imageUrl || p.media?.thumbUrl || p.image || null,
      price: parseMoney(amount),
      currency,
      shipping: null,
      condition: 'New',   // StockX is authenticated deadstock
      location: null,
      seller: { name: 'StockX', ratingPct: null, sales: null },
      engagement: { favourites: null, watchers: market.numberOfAsks ?? null },
      hasDescription: true,
    });
  }).filter(Boolean);
}
