// Markup-agnostic card harvester — the fallback that survives redesigns.
//
// Selector-based parsers break the moment a site renames its CSS classes (which
// is exactly what the first local run showed: DHgate/Alibaba returned 200 with
// real result pages, and the class-based parsers read 0 cards). This harvester
// uses the one thing a marketplace results page can't do without: product links.
// It finds every anchor matching the site's product-URL pattern, then climbs to
// the smallest enclosing container that shows a price, and reads the card from
// there. It's the same strategy that successfully extracted live listings from
// the real DHgate/AliExpress DOM in a browser inspection.

import * as cheerio from 'cheerio';

const PRICE_RE = /(£|US\s?\$|\$|€)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/;

export function harvest(html, { linkPatterns, minTitle = 10, maxCardText = 1500, limit = 60 } = {}) {
  const $ = cheerio.load(html);
  const patterns = Array.isArray(linkPatterns) ? linkPatterns : [linkPatterns];
  const selector = patterns.map(p => `a[href*="${p}"]`).join(',');
  const out = [];
  const seen = new Set();
  $(selector).each((_, el) => {
    const a = $(el);
    let href = a.attr('href') || '';
    if (!href) return;
    if (href.startsWith('//')) href = 'https:' + href;
    if (seen.has(href)) return;

    // Title: anchor title attr → anchor text → its image's alt → nearby heading.
    let title = (a.attr('title') || a.text() || '').replace(/\s+/g, ' ').trim();
    if (title.length < minTitle) title = (a.find('img').first().attr('alt') || '').replace(/\s+/g, ' ').trim();
    if (title.length < minTitle) {
      const h = a.closest('li,article,div').find('h1,h2,h3,[class*="title" i]').first();
      title = (h.text() || '').replace(/\s+/g, ' ').trim();
    }
    if (title.length < minTitle) return;

    // Climb to the smallest container carrying a price.
    let node = a, priceMatch = null, img = a.find('img').first(), hops = 0;
    while (node.length && hops < 7) {
      const text = node.text() || '';
      if (text.length > maxCardText) break;             // too big — we've left the card
      const m = text.match(PRICE_RE);
      if (m) { priceMatch = m; if (!img.length) img = node.find('img').first(); break; }
      if (!img.length) img = node.find('img').first();
      node = node.parent(); hops++;
    }
    if (!priceMatch) return;

    const amount = parseFloat(priceMatch[2].replace(/,/g, ''));
    if (!isFinite(amount) || amount <= 0) return;
    const sym = priceMatch[1].replace(/\s+/g, '');
    const currency = sym === '£' ? 'GBP' : sym === '€' ? 'EUR' : 'USD';
    let image = img.length ? (img.attr('data-src') || img.attr('src') || null) : null;
    if (image && image.startsWith('//')) image = 'https:' + image;

    seen.add(href);
    out.push({ href, title: title.slice(0, 120), amount, currency, image });
    if (out.length >= limit) return false;
  });
  return out;
}
