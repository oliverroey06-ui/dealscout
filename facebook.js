// Facebook Marketplace connector — unofficial, browser-driven, OFF by default.
//
// Meta offers no Marketplace API. Marketplace search is login-walled and
// aggressively bot-protected, so the only route is a real browser (Playwright)
// signed in with your own account. This is the most fragile connector and the
// one most clearly against Facebook's ToS. Enable it only knowingly.
//
// Setup:
//   1) npm i playwright && npx playwright install chromium
//   2) Log in once to capture a session:
//        node scripts/facebook-login.js   (opens a window; log in; it saves fb-state.json)
//   3) Set FACEBOOK_ENABLED=1 and FACEBOOK_STATE=./fb-state.json
//
// Facebook will still challenge/checkpoint automated sessions; treat any result
// as best-effort. If it stops working, turn it off — it does not affect the
// other four sources.

import { normalize, parseMoney } from '../normalize.js';

export const meta = { id: 'facebook', label: 'FB Marketplace', kind: 'browser' };

export async function search({ query, limit = 20, env, signal }) {
  if (env.FACEBOOK_ENABLED !== '1') {
    throw new Error('Facebook is off. Set FACEBOOK_ENABLED=1 and provide FACEBOOK_STATE (see connectors/facebook.js).');
  }
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { throw new Error('Facebook needs Playwright: npm i playwright && npx playwright install chromium'); }

  const stateFile = env.FACEBOOK_STATE || './fb-state.json';
  const city = env.FACEBOOK_CITY || 'london';
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      storageState: stateFile,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      viewport: { width: 1280, height: 900 }
    });
    const page = await ctx.newPage();
    const url = `https://www.facebook.com/marketplace/${city}/search?query=${encodeURIComponent(query)}&sortBy=creation_time_descend`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const raw = await page.$$eval('a[href*="/marketplace/item/"]', (anchors) => {
      const seen = new Set();
      const rows = [];
      for (const a of anchors) {
        const href = a.href.split('?')[0];
        if (seen.has(href)) continue;
        seen.add(href);
        const txt = a.innerText || '';
        const img = a.querySelector('img');
        rows.push({ href, txt, img: img ? img.src : null });
        if (rows.length >= 40) break;
      }
      return rows;
    });
    return raw.map((r) => mapCard(r)).filter(Boolean).slice(0, limit);
  } finally {
    await browser.close();
  }
}

// A Marketplace card's innerText is roughly: "£120\nItem title\nLocation".
function mapCard(r) {
  const lines = r.txt.split('\n').map(s => s.trim()).filter(Boolean);
  const priceLine = lines.find(l => /[£$€]|\bfree\b/i.test(l)) || lines[0] || '';
  const price = /free/i.test(priceLine) ? 0 : parseMoney(priceLine);
  const title = lines.find(l => l !== priceLine && l.length > 4) || '';
  const location = lines.length > 2 ? lines[lines.length - 1] : null;
  if (!title || price == null) return null;
  return normalize('facebook', {
    title, url: r.href, image: r.img,
    price, currency: 'GBP', shipping: 0,
    condition: null, location,
    seller: { name: null, ratingPct: null, sales: null },
    hasDescription: false
  });
}

export { mapCard as _mapCardForTest };
