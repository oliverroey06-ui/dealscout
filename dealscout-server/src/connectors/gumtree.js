// Gumtree connector — unofficial. No public API. Gumtree serves search results
// as server-rendered HTML, so we parse the listing cards with cheerio. Markup
// changes periodically, so the parser tries several selector candidates and
// degrades gracefully. Best-effort and against ToS.

import * as cheerio from 'cheerio';
import { normalize, parseMoney } from '../normalize.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

export const meta = { id: 'gumtree', label: 'Gumtree', kind: 'scrape' };

export async function search({ query, limit = 30, env, signal }) {
  const base = env.GUMTREE_BASE || 'https://www.gumtree.com';
  const url = `${base}/search?search_category=all&q=${encodeURIComponent(query)}&sort=date`;
  const res = await fetch(url, { signal, headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
  if (!res.ok) throw new Error(`Gumtree returned ${res.status}`);
  const html = await res.text();
  return parse(html, base).slice(0, limit);
}

export function parse(html, base = 'https://www.gumtree.com') {
  const $ = cheerio.load(html);
  const out = [];
  // Candidate card selectors, newest first.
  const cards = $('[data-q="search-result"], article.listing-maxi, li.natural, .js-search-result');
  cards.each((_, el) => {
    const $el = $(el);
    const a = $el.find('a[href*="/p/"], a[data-q="search-result-anchor"], a.listing-link').first();
    let href = a.attr('href');
    if (!href) return;
    if (href.startsWith('/')) href = base + href;
    const title = text($el, ['[data-q="tile-title"]', '.listing-title', 'h2', 'a[data-q="search-result-anchor"]']);
    const priceTxt = text($el, ['[data-q="tile-price"]', '.listing-price', 'meta[itemprop="price"]', 'strong']);
    const price = parseMoney(priceTxt);
    if (!title || price == null) return;
    const img = $el.find('img').first();
    const image = img.attr('src') || img.attr('data-src') || null;
    const location = text($el, ['[data-q="tile-location"]', '.listing-location', '.truncate-line']);
    out.push(normalize('gumtree', {
      title, url: href, image,
      price, currency: 'GBP', shipping: 0,
      condition: null, location: location || null,
      seller: { name: null, ratingPct: null, sales: null },
      hasDescription: !!text($el, ['[data-q="tile-description"]', '.listing-description'])
    }));
  });
  return out.filter(Boolean);
}

function text($el, selectors) {
  for (const s of selectors) {
    const node = $el.find(s).first();
    if (node.length) {
      const t = (node.attr('content') || node.text() || '').replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
  }
  return '';
}
