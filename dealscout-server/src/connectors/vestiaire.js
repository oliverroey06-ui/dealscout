// Vestiaire Collective connector — unofficial. Vestiaire's site queries a search
// API; the exact contract is undocumented and changes, so this is best-effort
// and defensive. Expect blocks from datacenter IPs. Against ToS.

import { normalize, parseMoney } from '../normalize.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
export const meta = { id: 'vestiaire', label: 'Vestiaire', kind: 'scrape' };

export async function search({ query, limit = 30, env, signal }) {
  const url = env.VESTIAIRE_SEARCH || 'https://search.vestiairecollective.com/v1/product/search';
  const res = await fetch(url, {
    method: 'POST', signal,
    headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ pagination: { offset: 0, limit: Math.min(40, limit) }, fields: [], q: query, filters: {} }),
  });
  if (!res.ok) throw new Error(`Vestiaire returned ${res.status} (undocumented API — may need a residential IP)`);
  return parse(await res.json()).slice(0, limit);
}

export function parse(json) {
  const arr = json.items || json.products || json.hits || json.results || [];
  return arr.map((p) => {
    const price = p.price?.cents != null ? p.price.cents / 100 : (p.price?.amount ?? p.price ?? p.priceWithVat);
    const currency = (p.price?.currency || p.currency || 'GBP').toUpperCase().slice(0, 3);
    return normalize('vestiaire', {
      id: p.id,
      title: [p.brand?.name || p.brand, p.name || p.title].filter(Boolean).join(' ').slice(0, 120) || String(p.id),
      url: p.link || (p.id ? `https://www.vestiairecollective.com/p/${p.id}.shtml` : null),
      image: p.pictures?.[0]?.url || p.image || p.cover || null,
      price: parseMoney(price),
      currency,
      shipping: null,
      condition: p.condition?.name || p.condition || null,
      location: p.country || null,
      seller: { name: p.seller?.username || null, ratingPct: null, sales: null },
      engagement: { favourites: p.likes ?? null, watchers: null },
      hasDescription: true,
    });
  }).filter(Boolean);
}
