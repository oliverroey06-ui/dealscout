// eBay connector — official Browse API (buy.browse.v1).
// This is the sanctioned, reliable source. Needs free credentials from
// https://developer.ebay.com  (App ID / Cert ID = client_id / client_secret).
//
// Auth: OAuth2 client-credentials -> a bearer token, cached until it expires.
// Docs: https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search

import * as cheerio from 'cheerio';
import { normalize, parseMoney, detectCurrency } from '../normalize.js';

const DEFAULT_OAUTH = 'https://api.ebay.com/identity/v1/oauth2/token';
const DEFAULT_SEARCH = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

let tokenCache = { token: null, exp: 0 };

async function getToken(env) {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.exp - 60_000) return tokenCache.token;
  const id = env.EBAY_CLIENT_ID, secret = env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('eBay disabled: set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET');
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch(env.EBAY_OAUTH_URL || DEFAULT_OAUTH, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`
  });
  if (!res.ok) throw new Error(`eBay OAuth failed (${res.status}). Check your credentials and that they are Production keys.`);
  const j = await res.json();
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 7200) * 1000 };
  return tokenCache.token;
}

export const meta = { id: 'ebay', label: 'eBay', kind: 'api' };

// eBay works two ways. With API keys it uses the official Browse API (reliable,
// sanctioned). Without keys it falls back to scraping the public search results
// page the same best-effort way Vinted/Gumtree do — so you get live eBay listings
// with zero setup, at the cost of the usual scraping fragility/ToS caveats. Add
// keys any time to switch to the rock-solid path.
export async function search(opts) {
  const { env } = opts;
  if (env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET) return searchApi(opts);
  return searchScrape(opts);
}

async function searchApi({ query, limit = 30, env, signal }) {
  const token = await getToken(env);
  const marketplace = env.EBAY_MARKETPLACE || 'EBAY_GB';
  const searchBase = env.EBAY_SEARCH_URL || DEFAULT_SEARCH;
  const url = `${searchBase}?q=${encodeURIComponent(query)}&limit=${Math.min(50, limit)}&sort=newlyListed`;
  const res = await fetch(url, {
    signal,
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplace,
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`eBay search failed (${res.status})`);
  const j = await res.json();
  const items = j.itemSummaries || [];
  return items.map(mapItem).filter(Boolean);
}

function mapItem(it) {
  const isAuction = Array.isArray(it.buyingOptions) && it.buyingOptions.includes('AUCTION');
  let endsInMin = null;
  if (isAuction && it.itemEndDate) {
    const d = new Date(it.itemEndDate).getTime();
    if (isFinite(d)) endsInMin = Math.max(0, Math.round((d - Date.now()) / 60000));
  }
  const ship = it.shippingOptions?.[0]?.shippingCost;
  return normalize('ebay', {
    id: it.itemId,
    title: it.title,
    url: it.itemWebUrl,
    image: it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl || null,
    price: it.price?.value,
    currency: it.price?.currency || 'GBP',
    shipping: ship ? ship.value : (it.shippingOptions?.[0]?.shippingCostType === 'CALCULATED' ? null : 0),
    condition: it.condition || null,
    location: [it.itemLocation?.city, it.itemLocation?.postalCode, it.itemLocation?.country].filter(Boolean).join(', ') || null,
    auctionEndsInMin: endsInMin,
    seller: {
      name: it.seller?.username || null,
      ratingPct: it.seller?.feedbackPercentage != null ? parseFloat(it.seller.feedbackPercentage) : null,
      sales: it.seller?.feedbackScore != null ? Number(it.seller.feedbackScore) : null
    },
    hasDescription: !!(it.shortDescription && it.shortDescription.length > 20)
  });
}

// Exposed for fixture tests without network.
export function _mapItemsForTest(json) {
  return (json.itemSummaries || []).map(mapItem).filter(Boolean);
}

// --- no-key HTML scrape path ---
async function searchScrape({ query, limit = 30, env, signal }) {
  const base = env.EBAY_WEB_BASE || 'https://www.ebay.co.uk';
  const url = `${base}/sch/i.html?_nkw=${encodeURIComponent(query)}&_sop=10&_ipg=60`;
  const res = await fetch(url, { signal, headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
  if (!res.ok) throw new Error(`eBay search page returned ${res.status} (no API keys set — using scrape fallback)`);
  const html = await res.text();
  return parseSearch(html, base).slice(0, limit);
}

export function parseSearch(html, base = 'https://www.ebay.co.uk') {
  const $ = cheerio.load(html);
  const out = [];
  $('li.s-item, li.srp-results__item, .s-card').each((_, el) => {
    const $el = $(el);
    const a = $el.find('a.s-item__link, a.su-link, a[href*="/itm/"]').first();
    let href = a.attr('href');
    if (!href) return;
    href = href.split('?')[0];
    const title = clean($el.find('.s-item__title, .su-styled-text.primary, [role="heading"]').first().text());
    // eBay injects a "Shop on eBay" template card first — skip it and empties.
    if (!title || /^shop on ebay$/i.test(title) || !/\/itm\//.test(href)) return;
    const priceTxt = $el.find('.s-item__price, .su-styled-text.bold').first().text();
    const price = parseMoney(priceTxt);
    if (price == null) return;
    const img = $el.find('.s-item__image-wrapper img, .s-item__image img, img').first();
    const image = img.attr('src') || img.attr('data-src') || null;
    const cond = clean($el.find('.SECONDARY_INFO, .s-item__subtitle').first().text());
    const loc = clean($el.find('.s-item__location, .s-item__itemLocation').first().text()).replace(/^from\s+/i, '');
    const isAuction = /bid/i.test($el.find('.s-item__purchase-options-with-icon, .s-item__bids, .s-item__time-left').text());
    out.push(normalize('ebay', {
      title, url: href, image,
      price, currency: detectCurrency(priceTxt, 'GBP'),
      shipping: null,
      condition: cond || null,
      location: loc || null,
      seller: { name: null, ratingPct: null, sales: null },
      hasDescription: false
    }));
  });
  // De-dup by URL (eBay repeats some cards).
  const seen = new Set();
  return out.filter(l => l && !seen.has(l.url) && seen.add(l.url));
}

function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
