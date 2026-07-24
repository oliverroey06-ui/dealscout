// CSSbuy connector — unofficial. CSSbuy is a Taobao/Weidian/1688 buying + parcel-
// forwarding agent; its search proxies those platforms. The endpoint is
// undocumented and changes, so this is the least reliable China source — kept
// defensive and best-effort. Prices (CNY) → approx GBP. Subject to ToS.

import { normalize, toGBP } from '../normalize.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
export const meta = { id: 'cssbuy', label: 'CSSbuy', kind: 'scrape', group: 'china' };

export async function search({ query, limit = 30, env, signal }) {
  const base = env.CSSBUY_BASE || 'https://cssbuy.com';
  const url = `${base}/api/search?keyword=${encodeURIComponent(query)}&page=1&type=taobao`;
  const res = await fetch(url, { signal, headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`CSSbuy returned ${res.status} (undocumented agent search — may need updating)`);
  let data;
  try { data = await res.json(); } catch { throw new Error('CSSbuy: response was not JSON (endpoint changed)'); }
  return parse(data, env).slice(0, limit);
}

export function parse(json, env = null) {
  const list = json?.data?.list || json?.list || json?.items || (Array.isArray(json?.data) ? json.data : []);
  return (Array.isArray(list) ? list : []).map((it) => {
    const id = it.num_iid || it.itemId || it.id || it.goodsId;
    let img = it.pic_url || it.picUrl || it.pic || it.img || null;
    if (img && img.startsWith('//')) img = 'https:' + img;
    return normalize('cssbuy', {
      id,
      title: it.title || it.name || '',
      url: it.detail_url || (id ? `https://cssbuy.com/item-${id}.html` : null),
      image: img,
      price: toGBP(it.price ?? it.promotion_price ?? it.orginal_price, 'CNY', env),
      currency: 'GBP',
      condition: null,
      location: 'China (via agent)',
      seller: { name: it.seller_nick || it.nick || null, ratingPct: null, sales: null },
      engagement: { favourites: null, watchers: null },
      hasDescription: false,
    });
  }).filter(Boolean);
}
