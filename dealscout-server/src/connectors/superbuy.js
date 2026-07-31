// Superbuy connector — searches Taobao/Tmall through Superbuy's own search API:
//   POST front.superbuy.com/crawler/search-product   (form-encoded)
// discovered by watching the real site's network traffic in a browser. Verified
// to work ANONYMOUSLY — no Superbuy account or cookies needed. Each result links
// to Superbuy's agent checkout wrapping the underlying Taobao listing, so a user
// can buy it through the agent. Prices are requested in USD → approx GBP.

import { normalize, toGBP } from '../normalize.js';
import { scrapeFetch } from '../net.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
export const meta = { id: 'superbuy', label: 'Superbuy', kind: 'scrape', group: 'china' };

export async function search({ query, limit = 30, env, signal }) {
  const base = env.SUPERBUY_BASE || 'https://front.superbuy.com';
  const size = String(Math.min(60, limit));
  const body = new URLSearchParams({
    keyword: query, platform: 'taobao', pageNo: '1', toPage: '1',
    pageSize: size, perPageSize: size, currency: 'USD', translate: '1',
  }).toString();
  const res = await scrapeFetch(`${base}/crawler/search-product`, {
    method: 'POST', signal,
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-GB,en;q=0.9',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': 'https://www.superbuy.com',
      'Referer': 'https://www.superbuy.com/',
    },
    body,
  }, env);
  if (!res.ok) {
    // Surface what Superbuy actually said, so a failing pill is diagnosable.
    const t = await res.text().catch(() => '');
    throw new Error(`Superbuy returned ${res.status}${t ? ' · ' + t.replace(/\s+/g, ' ').slice(0, 90) : ''}`);
  }
  let j; try { j = await res.json(); } catch { throw new Error('Superbuy: non-JSON response (endpoint changed or challenged)'); }
  const out = parse(j, env);
  if (!out.length && j && j.state !== undefined && j.state !== 0) {
    throw new Error(`Superbuy API refused (state ${j.state}${j.msg ? ': ' + String(j.msg).slice(0, 80) : ''})`);
  }
  return out.slice(0, limit);
}

export function parse(json, env = null) {
  const items = json?.data?.datas?.[0]?.intResults || [];
  return (Array.isArray(items) ? items : []).map((it) => {
    const taobao = it.goodsUrl || (it.goodsId ? `https://item.taobao.com/item.htm?id=${it.goodsId}` : null);
    let img = it.imgUrl || null;
    if (img && img.startsWith('//')) img = 'https:' + img;
    const sold = Number(String(it.statusText || '').replace(/[^0-9]/g, ''));
    return normalize('superbuy', {
      id: it.goodsId,
      title: it.title || it.titleCn || '',
      url: taobao ? `https://www.superbuy.com/en/page/buy/?url=${encodeURIComponent(taobao)}` : null,
      image: img,
      price: toGBP(it.price, 'USD', env),
      currency: 'GBP',
      shipping: null,
      condition: null,
      location: 'China (via Superbuy agent)',
      seller: { name: it.shop?.name || it.shop?.shopName || null, ratingPct: null, sales: null },
      engagement: { favourites: null, watchers: isFinite(sold) && sold > 0 ? sold : (Number(it.popularity) > 0 ? Number(it.popularity) : null) },
      hasDescription: false,
    });
  }).filter(Boolean);
}
