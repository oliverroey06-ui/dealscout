// DHgate connector — unofficial. DHgate is a legitimate China wholesale/retail
// marketplace with no public API; we scrape its search HTML with cheerio. Prices
// (USD) are converted to approx GBP. Best-effort, subject to ToS.

import * as cheerio from 'cheerio';
import { normalize, toGBP } from '../normalize.js';
import { scrapeFetch } from '../net.js';
import { harvest } from './harvest.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
export const meta = { id: 'dhgate', label: 'DHgate', kind: 'scrape', group: 'china' };

export async function search({ query, limit = 30, env, signal }) {
  const base = env.DHGATE_BASE || 'https://www.dhgate.com';
  const url = `${base}/wholesale/search.do?act=search&searchkey=${encodeURIComponent(query)}`;
  const res = await scrapeFetch(url, { signal, headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-GB,en;q=0.9' } }, env);
  if (!res.ok) throw new Error(`DHgate returned ${res.status}`);
  return parse(await res.text(), env).slice(0, limit);
}

export function parse(html, env = null) {
  const $ = cheerio.load(html);
  const out = [];
  $('.listitem, li.item, .search-product-item, div.item').each((_, el) => {
    const $el = $(el);
    const a = $el.find('a.pro-title, .subject a, a.item-name, a[href*="/product/"]').first();
    const title = (a.text().trim() || $el.find('img').attr('alt') || '').trim();
    let url = a.attr('href') || '';
    if (url.startsWith('//')) url = 'https:' + url;
    const priceText = $el.find('.price .rs, .currentprice, .item-price, .price').first().text();
    let img = $el.find('img').attr('data-src') || $el.find('img').attr('src') || null;
    if (img && img.startsWith('//')) img = 'https:' + img;
    out.push(normalize('dhgate', {
      title, url, image: img,
      price: priceText.includes('£') ? priceText : toGBP(priceText, 'USD', env),
      currency: 'GBP',
      condition: 'New', location: 'China',
      seller: { name: null, ratingPct: null, sales: null },
      engagement: { favourites: null, watchers: null },
      hasDescription: true,
    }));
  });
  const legacy = out.filter(Boolean);
  if (legacy.length) return legacy;
  // Class names changed (real 2026 pages) — fall back to the link-walk harvester.
  return harvest(html, { linkPatterns: '/product/' }).map(c => normalize('dhgate', {
    title: c.title, url: c.href, image: c.image,
    price: c.currency === 'GBP' ? c.amount : toGBP(c.amount, c.currency, env),
    currency: 'GBP', condition: 'New', location: 'China',
    seller: { name: null, ratingPct: null, sales: null },
    engagement: { favourites: null, watchers: null },
    hasDescription: true,
  })).filter(Boolean);
}
