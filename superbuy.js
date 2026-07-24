// Superbuy connector — unofficial. Superbuy is a Taobao/Weidian buying + parcel-
// forwarding agent; its search proxies those Chinese platforms through an internal
// JSON API. Prices (CNY) → approx GBP. Best-effort, bot-protected, subject to ToS.

import { normalize, toGBP } from '../normalize.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
export const meta = { id: 'superbuy', label: 'Superbuy', kind: 'scrape', group: 'china' };

export async function search({ query, limit = 30, env, signal }) {
  const base = env.SUPERBUY_BASE || 'https://front.superbuy.com';
  const url = `${base}/search/api/list?keyword=${encodeURIComponent(query)}&page=1&pageSize=${Math.min(40, limit)}&platform=taobao&o=`;
  const res = await fetch(url, { signal, headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://www.superbuy.com/' } });
  if (!res.ok) throw new Error(`Superbuy returned ${res.status} (agent search is bot-protected)`);
  return parse(await res.json(), env).slice(0, limit);
}

export function parse(json, env = null) {
  const list = json?.data?.list || json?.data?.goodsList || json?.list || [];
  return (Array.isArray(list) ? list : []).map((it) => {
    const id = it.goodsId || it.itemId || it.id || it.tao_id;
    let img = it.picUrl || it.pic || it.imgUrl || it.image || null;
    if (img && img.startsWith('//')) img = 'https:' + img;
    const taobao = id ? `https://item.taobao.com/item.htm?id=${id}` : null;
    const link = it.superbuyUrl || it.goodsUrl ||
      (taobao ? `https://www.superbuy.com/en/page/buy/?url=${encodeURIComponent(taobao)}` : null);
    return normalize('superbuy', {
      id,
      title: it.title || it.goodsName || it.name || '',
      url: link,
      image: img,
      price: toGBP(it.price ?? it.promotionPrice ?? it.shopPrice, 'CNY', env),
      currency: 'GBP',
      condition: null,
      location: 'China (via agent)',
      seller: { name: it.shopName || null, ratingPct: null, sales: null },
      engagement: { favourites: null, watchers: numOr(it.sales) },
      hasDescription: false,
    });
  }).filter(Boolean);
}
function numOr(v) { const n = Number(v); return isFinite(n) ? n : null; }
