// Alibaba connector — unofficial. B2B wholesale, so prices are per-unit and often
// carry a minimum order quantity; we take the lower bound of each price range. No
// public API — we scrape the search HTML with cheerio. USD → approx GBP.
// Best-effort, subject to ToS.

import * as cheerio from 'cheerio';
import { normalize, toGBP } from '../normalize.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
export const meta = { id: 'alibaba', label: 'Alibaba', kind: 'scrape', group: 'china' };

export async function search({ query, limit = 30, env, signal }) {
  const base = env.ALIBABA_BASE || 'https://www.alibaba.com';
  const url = `${base}/trade/search?fsb=y&SearchText=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-GB,en;q=0.9' } });
  if (!res.ok) throw new Error(`Alibaba returned ${res.status}`);
  return parse(await res.text(), env).slice(0, limit);
}

export function parse(html, env = null) {
  const $ = cheerio.load(html);
  const out = [];
  $('.organic-list-offer, .list-no-v2-outter, .fy23-search-card, div.offer-wrapper').each((_, el) => {
    const $el = $(el);
    const a = $el.find('a.organic-gallery-title__link, a[href*="/product-detail/"], h2 a').first();
    const title = (a.text().trim() || $el.find('img').attr('alt') || '').trim();
    let url = a.attr('href') || '';
    if (url.startsWith('//')) url = 'https:' + url;
    const priceText = $el.find('.organic-gallery-offer-section__price, .elements-offer-price-normal__price, .price').first().text();
    const first = (priceText.match(/[\d.,]+/) || [])[0];   // "$1.20 - $3.50" -> "1.20"
    let img = $el.find('img').attr('data-src') || $el.find('img').attr('src') || null;
    if (img && img.startsWith('//')) img = 'https:' + img;
    out.push(normalize('alibaba', {
      title, url, image: img,
      price: toGBP(first, 'USD', env),
      currency: 'GBP',
      condition: 'New', location: 'China',
      seller: { name: $el.find('.supplier a, .organic-gallery-offer__seller a').first().text().trim() || null, ratingPct: null, sales: null },
      engagement: { favourites: null, watchers: null },
      hasDescription: true,
    }));
  });
  return out.filter(Boolean);
}
