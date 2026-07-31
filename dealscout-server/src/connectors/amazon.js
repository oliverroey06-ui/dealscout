// Amazon connector — unofficial, the "Discounts" group. Scrapes amazon.co.uk
// search results and keeps ONLY items showing a strike-through "was" price, so
// everything it returns is a real, currently-discounted item with its % off.
//
// Honesty first: Amazon only serves full results to cookie-carrying browsers.
// An anonymous server fetch usually gets a small bot-gate page (verified live:
// ~2KB shell), so expect this to need the residential proxy — and even then
// it's best-effort. With official Product Advertising API keys this could be
// made solid; that needs an Amazon Associates account.

import * as cheerio from 'cheerio';
import { normalize, parseMoney } from '../normalize.js';
import { scrapeFetch } from '../net.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
export const meta = { id: 'amazon', label: 'Amazon deals', kind: 'scrape', group: 'discounts' };

export async function search({ query, limit = 30, env, signal }) {
  const base = env.AMAZON_BASE || 'https://www.amazon.co.uk';
  const url = `${base}/s?k=${encodeURIComponent(query)}`;
  const res = await scrapeFetch(url, {
    signal,
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-GB,en;q=0.9' },
  }, env);
  if (!res.ok) throw new Error(`Amazon returned ${res.status}`);
  const html = await res.text();
  if (html.length < 20000 || /robot check|captcha|automated access|api-services-support/i.test(html)) {
    throw new Error(`Amazon served a bot-gate page (${html.length}b) — Amazon only shows results to cookie-carrying browsers; needs the residential proxy (or official PA-API keys)`);
  }
  return parse(html, base).slice(0, limit);
}

export function parse(html, base = 'https://www.amazon.co.uk') {
  const $ = cheerio.load(html);
  const out = [];
  $('[data-asin]').each((_, el) => {
    const $el = $(el);
    const asin = $el.attr('data-asin');
    if (!asin || asin.length < 10) return;
    const title = clean($el.find('h2 span').first().text() || $el.find('img.s-image').attr('alt'));
    if (!title || title.length < 8) return;
    const nowTxt = $el.find('.a-price:not(.a-text-price) .a-offscreen').first().text();
    const wasTxt = $el.find('.a-price.a-text-price .a-offscreen').first().text();
    const now = parseMoney(nowTxt), was = parseMoney(wasTxt);
    if (now == null || was == null || was <= now) return;   // discounted items only
    const img = $el.find('img.s-image').first();
    const n = normalize('amazon', {
      id: asin,
      title,
      url: `${base}/dp/${asin}`,
      image: img.attr('src') || null,
      price: now,
      currency: nowTxt.includes('£') ? 'GBP' : nowTxt.includes('€') ? 'EUR' : 'USD',
      shipping: null,
      condition: 'New',
      location: null,
      seller: { name: 'Amazon marketplace', ratingPct: null, sales: null },
      engagement: { favourites: null, watchers: null },
      hasDescription: true,
    });
    if (!n) return;
    n.wasPrice = was;
    n.discountPct = Math.round(((was - now) / was) * 100);
    out.push(n);
  });
  const seen = new Set();
  return out.filter(l => !seen.has(l.id) && seen.add(l.id));
}
function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
