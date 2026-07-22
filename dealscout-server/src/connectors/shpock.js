// Shpock connector — unofficial. No public API. Shpock's web results are driven
// by an internal JSON API; when a JSON endpoint is reachable we use it, otherwise
// we fall back to parsing embedded JSON from the results HTML. This is the most
// likely of the four scrapers to need selector/endpoint updates against the live
// site, because Shpock changes it often. Best-effort and against ToS.

import * as cheerio from 'cheerio';
import { normalize, parseMoney, detectCurrency } from '../normalize.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

export const meta = { id: 'shpock', label: 'Shpock', kind: 'scrape' };

export async function search({ query, limit = 30, env, signal }) {
  const base = env.SHPOCK_BASE || 'https://www.shpock.com';
  const url = `${base}/en-gb/results?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
  if (!res.ok) throw new Error(`Shpock returned ${res.status}`);
  const html = await res.text();
  return parse(html, base).slice(0, limit);
}

// Shpock embeds its listing data as JSON in the page (Next.js __NEXT_DATA__ or a
// window.__PRELOADED_STATE__ blob). We try structured JSON first, then DOM cards.
export function parse(html, base = 'https://www.shpock.com') {
  const fromJson = parseEmbeddedJson(html, base);
  if (fromJson.length) return fromJson;
  return parseDom(html, base);
}

function parseEmbeddedJson(html, base) {
  const out = [];
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return out;
  let data;
  try { data = JSON.parse(m[1]); } catch { return out; }
  // Walk the tree for objects that look like items (have id + price + title).
  const seen = new Set();
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const looksLikeItem = node.title && (node.price != null || node.priceValue != null) && (node.id || node.slug);
    if (looksLikeItem && !seen.has(node.id || node.slug)) {
      seen.add(node.id || node.slug);
      const slug = node.slug || node.id;
      const price = node.price?.amount ?? node.priceValue ?? node.price;
      const norm = normalize('shpock', {
        id: node.id || slug,
        title: node.title,
        url: node.url || (slug ? `${base}/en-gb/i/${slug}` : null),
        image: node.image?.url || node.images?.[0]?.url || node.thumbnail || null,
        price,
        currency: node.price?.currency || 'GBP',
        shipping: node.shippingAvailable ? null : 0,
        condition: node.condition || null,
        location: node.location?.name || node.city || null,
        seller: { name: node.user?.name || null, ratingPct: null, sales: null },
        hasDescription: !!(node.description && node.description.length > 20)
      });
      if (norm) out.push(norm);
    }
    for (const k in node) walk(node[k]);
  })(data);
  return out;
}

function parseDom(html, base) {
  const $ = cheerio.load(html);
  const out = [];
  $('[data-testid="item-card"], article, a[href*="/i/"]').each((_, el) => {
    const $el = $(el);
    const a = $el.is('a') ? $el : $el.find('a[href*="/i/"]').first();
    let href = a.attr('href');
    if (!href) return;
    if (href.startsWith('/')) href = base + href;
    const title = ($el.find('[data-testid="item-title"], h2, h3').first().text() || a.attr('title') || '').trim();
    const priceTxt = $el.find('[data-testid="item-price"], .price').first().text();
    const price = parseMoney(priceTxt);
    if (!title || price == null) return;
    out.push(normalize('shpock', {
      title, url: href,
      image: $el.find('img').first().attr('src') || null,
      price, currency: detectCurrency(priceTxt),
      shipping: null, condition: null,
      location: $el.find('[data-testid="item-location"]').first().text().trim() || null,
      seller: { name: null, ratingPct: null, sales: null },
      hasDescription: false
    }));
  });
  return out.filter(Boolean);
}
