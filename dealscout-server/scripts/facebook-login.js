// One-time helper to capture a Facebook session for the Marketplace connector.
// Opens a real browser window; you log in by hand; it saves fb-state.json.
//
//   npm i playwright && npx playwright install chromium
//   node scripts/facebook-login.js
//
// Then set FACEBOOK_ENABLED=1 and FACEBOOK_STATE=./fb-state.json in .env.
// Note: this is against Facebook's ToS and the session will expire / get
// challenged periodically. It is entirely optional.

import { chromium } from 'playwright';

const out = process.env.FACEBOOK_STATE || './fb-state.json';
const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto('https://www.facebook.com/login');
console.log('\n  Log in to Facebook in the window, reach your feed, then press Enter here.\n');
process.stdin.resume();
await new Promise((r) => process.stdin.once('data', r));
await ctx.storageState({ path: out });
console.log(`  Saved session → ${out}`);
await browser.close();
process.exit(0);
