// eBay connector — official Browse API (buy.browse.v1).
// This is the sanctioned, reliable source. Needs free credentials from
// https://developer.ebay.com  (App ID / Cert ID = client_id / client_secret).
//
// Auth: OAuth2 client-credentials -> a bearer token, cached until it expires.
// Docs: https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search

import { normalize } from '../normalize.js';

const DEFAULT_OAUTH = 'https://api.ebay.com/identity/v1/oauth2/token';
const DEFAULT_SEARCH = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';

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

export async function search({ query, limit = 30, env, signal }) {
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
