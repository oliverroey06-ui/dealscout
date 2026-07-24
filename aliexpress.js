// AliExpress connector — unofficial. AliExpress embeds its search results as JSON
// inside the search page (window._init_data_ / runParams). We fetch the search
// HTML, pull that JSON out, and map it. Prices (USD) are converted to approx GBP.
// Heavily bot-protected: expect blocks from datacenter IPs. Best-effort, ToS.

import { normalize, toGBP } from '../normalize.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
export const meta = { id: 'aliexpress', label: 'AliExpress', kind: 'scrape', group: 'china' };

export async function search({ query, limit = 30, env, signal }) {
  const base = env.ALIEXPRESS_BASE || 'https://www.aliexpress.com';
  const url = `${base}/wholesale?trafficChannel=main&SearchText=${encodeURIComponent(query)}&g=y`;
  const res = await fetch(url, { signal, headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-GB,en;q=0.9' } });
  if (!res.ok) throw new Error(`AliExpress returned ${res.status} (bot-protected — usually needs a residential IP)`);
  const json = extractJson(await res.text());
  if (!json) throw new Error('AliExpress: could not find embedded results (markup changed or challenged)');
  return parse(json, env).slice(0, limit);
}

// Pull the first balanced JSON object assigned to one of AliExpress's globals.
function extractJson(html) {
  for (const k of ['_init_data_', 'window.runParams', '_dida_config_']) {
    const i = html.indexOf(k);
    if (i < 0) continue;
    const brace = html.indexOf('{', i);
    if (brace < 0) continue;
    const slice = sliceBalanced(html, brace);
    if (!slice) continue;
    try { const o = JSON.parse(slice); return o.data || o; } catch { /* try next */ }
  }
  return null;
}
function sliceBalanced(s, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { if (--depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

export function parse(json, env = null) {
  return findItems(json).map((it) => {
    const id = it.productId || it.objectId || it.id;
    const t = it.title?.displayTitle || it.title?.seoTitle || it.subject || it.title;
    const priceRaw = it.prices?.salePrice?.minPrice ?? it.prices?.salePrice?.value ?? it.salePrice?.minPrice ?? it.minPrice ?? it.price;
    let img = it.image?.imgUrl || it.imageUrl || it.image || null;
    if (img && img.startsWith('//')) img = 'https:' + img;
    return normalize('aliexpress', {
      id,
      title: typeof t === 'string' ? t : '',
      url: id ? `https://www.aliexpress.com/item/${id}.html` : null,
      image: img,
      price: toGBP(priceRaw, 'USD', env),
      currency: 'GBP',
      shipping: null,
      condition: 'New',
      location: 'China',
      seller: { name: it.store?.storeName || it.storeName || null, ratingPct: null, sales: null },
      engagement: { favourites: null, watchers: parseOrders(it.trade?.tradeDesc || it.tradeDesc) },
      hasDescription: true,
    });
  }).filter(Boolean);
}

function findItems(json) {
  const paths = [
    j => j?.mods?.itemList?.content,
    j => j?.data?.mods?.itemList?.content,
    j => j?.itemList?.content,
    j => j?.items,
    j => j?.result?.items,
  ];
  for (const p of paths) { const v = p(json); if (Array.isArray(v) && v.length) return v; }
  return [];
}
function parseOrders(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g, '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}
