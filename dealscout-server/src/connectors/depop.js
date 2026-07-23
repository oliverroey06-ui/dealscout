// Depop connector — unofficial. Depop's website is driven by an internal search
// JSON API. Best-effort and against ToS, like the other scrapers. Defensive
// about field names because Depop has shipped a few shapes over time.

import { normalize, parseMoney } from '../normalize.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
export const meta = { id: 'depop', label: 'Depop', kind: 'scrape' };

export async function search({ query, limit = 30, env, signal }) {
  const base = env.DEPOP_API || 'https://webapi.depop.com';
  const url = `${base}/api/v3/search/products/?what=${encodeURIComponent(query)}&itemsPerPage=${Math.min(40, limit)}`;
  const res = await fetch(url, { signal, headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Depop API returned ${res.status}`);
  return parse(await res.json()).slice(0, limit);
}

export function parse(json) {
  const arr = json.products || json.objects || json.results || [];
  return arr.map((p) => {
    const priceObj = p.price || {};
    const amount = priceObj.priceAmount ?? priceObj.priceAmountAsNumber ?? priceObj.amount ?? p.priceAmount;
    const currency = (priceObj.currencyName || priceObj.currency || 'GBP').toUpperCase().slice(0, 3);
    const slug = p.slug || p.id;
    const img = p.preview?.['320'] || p.preview?.url || p.pictures?.[0]?.url || p.pictures?.[0]?.['320'] || (Array.isArray(p.pictureData) ? p.pictureData[0]?.url : null);
    const desc = p.title || p.description || '';
    const brand = p.brandName || '';
    const title = (brand && !desc.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${desc}` : desc).trim().slice(0, 120) || `Depop item ${slug}`;
    return normalize('depop', {
      id: p.id || slug,
      title,
      rawTitle: p.description || null,
      url: p.url || (slug ? `https://www.depop.com/products/${slug}/` : null),
      image: img,
      price: parseMoney(amount),
      currency,
      shipping: null,
      condition: p.condition || p.itemCondition || null,
      location: p.countryCode || null,
      seller: { name: p.sellerUsername || p.seller?.username || null, ratingPct: null, sales: null },
      engagement: { favourites: p.likeCount ?? null, watchers: null },
      hasDescription: !!p.description,
    });
  }).filter(Boolean);
}
