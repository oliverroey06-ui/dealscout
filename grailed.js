// Grailed connector — unofficial. Grailed's search is powered by Algolia, which
// needs an application id + search key. Those are public (embedded in Grailed's
// own frontend) but rotate, so we read them from env rather than hard-coding a
// pair that will silently break. Without them this source reports "needs config"
// instead of failing mysteriously. Best-effort and against ToS.

import { normalize, parseMoney } from '../normalize.js';

export const meta = { id: 'grailed', label: 'Grailed', kind: 'scrape' };

export async function search({ query, limit = 30, env, signal }) {
  const appId = env.GRAILED_ALGOLIA_APP_ID, apiKey = env.GRAILED_ALGOLIA_API_KEY;
  const index = env.GRAILED_ALGOLIA_INDEX || 'Listing_production';
  if (!appId || !apiKey) throw new Error('Grailed needs GRAILED_ALGOLIA_APP_ID/API_KEY (public keys from grailed.com) to search');
  const url = `https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(index)}/query`;
  const res = await fetch(url, {
    method: 'POST', signal,
    headers: { 'X-Algolia-Application-Id': appId, 'X-Algolia-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, hitsPerPage: Math.min(40, limit) }),
  });
  if (!res.ok) throw new Error(`Grailed/Algolia returned ${res.status}`);
  return parse(await res.json()).slice(0, limit);
}

export function parse(json) {
  return (json.hits || []).map((h) => normalize('grailed', {
    id: h.id || h.objectID,
    title: [h.designer_names || h.designers?.map(d => d.name).join(' '), h.title].filter(Boolean).join(' ').slice(0, 120) || h.title,
    url: h.id ? `https://www.grailed.com/listings/${h.id}` : null,
    image: h.cover_photo?.url || h.photos?.[0]?.url || h.image_url || null,
    price: parseMoney(h.price ?? h.price_i),
    currency: 'USD',
    shipping: null,
    condition: h.condition || null,
    location: h.location || null,
    seller: { name: h.seller?.username || null, ratingPct: null, sales: null },
    engagement: { favourites: h.hearts ?? null, watchers: null },
    hasDescription: !!h.description,
  })).filter(Boolean);
}
