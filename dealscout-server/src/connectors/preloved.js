// Preloved connector — unofficial. Preloved.co.uk serves search results as
// server-rendered HTML, parsed with cheerio. Best-effort; selectors may drift.

import * as cheerio from 'cheerio';
import { normalize, parseMoney } from '../normalize.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
export const meta = { id: 'preloved', label: 'Preloved', kind: 'scrape' };

export async function search({ query, limit = 30, env, signal }) {
  const base = env.PRELOVED_BASE || 'https://www.preloved.co.uk';
  const url = `${base}/search?keyword=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
  if (!res.ok) throw new Error(`Preloved returned ${res.status}`);
  return parse(await res.text(), base).slice(0, limit);
}

export function parse(html, base = 'https://www.preloved.co.uk') {
  const $ = cheerio.load(html);
  const out = [];
  $('[data-testid="advert-card"], .advert, li.results__item, article').each((_, el) => {
    const $el = $(el);
    const a = $el.find('a[href*="/adverts/"], a.advert__link, a[href*="/classified/"]').first();
    let href = a.attr('href'); if (!href) return;
    if (href.startsWith('/')) href = base + href;
    const title = clean($el.find('.advert__title, [data-testid="advert-title"], h2, h3').first().text() || a.attr('title'));
    const priceTxt = $el.find('.advert__price, [data-testid="advert-price"], .price').first().text();
    const price = parseMoney(priceTxt);
    if (!title || price == null) return;
    const img = $el.find('img').first();
    out.push(normalize('preloved', {
      title, url: href,
      image: img.attr('src') || img.attr('data-src') || null,
      price, currency: 'GBP', shipping: null,
      condition: null,
      location: clean($el.find('.advert__location, [data-testid="advert-location"]').first().text()) || null,
      seller: { name: null, ratingPct: null, sales: null },
      hasDescription: false,
    }));
  });
  const seen = new Set();
  return out.filter(l => l && !seen.has(l.url) && seen.add(l.url));
}
function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
