import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { _mapItemsForTest as mapEbay, parseSearch as parseEbaySearch } from '../src/connectors/ebay.js';
import { _mapItemsForTest as mapVinted } from '../src/connectors/vinted.js';
import { parse as parseGumtree } from '../src/connectors/gumtree.js';
import { _mapCardForTest as mapFbCard } from '../src/connectors/facebook.js';
import { scoreScan, buildBand } from '../src/valuation.js';
import { normalize, parseMoney } from '../src/normalize.js';

const dir = dirname(fileURLToPath(import.meta.url));
const fx = (f) => readFileSync(join(dir, 'fixtures', f), 'utf8');

test('parseMoney handles symbols, commas, junk', () => {
  assert.equal(parseMoney('£1,234.50'), 1234.5);
  assert.equal(parseMoney('  20 '), 20);
  assert.equal(parseMoney('Free'), null);
  assert.equal(parseMoney(415), 415);
});

test('eBay parser maps official Browse API shape', () => {
  const items = mapEbay(JSON.parse(fx('ebay.json')));
  assert.equal(items.length, 5);
  const first = items[0];
  assert.equal(first.source, 'ebay');
  assert.equal(first.price, 310);
  assert.equal(first.currency, 'GBP');
  assert.equal(first.url, 'https://www.ebay.co.uk/itm/1101');
  assert.equal(first.seller.ratingPct, 99.4);
  assert.equal(first.shipping, 5.95);
  // auction end date -> minutes remaining
  const auction = items.find(i => i.id === 'ebay:v1|1102|0');
  assert.ok(auction.auctionEndsInMin > 0);
});

test('Vinted parser handles both price shapes and builds title', () => {
  const items = mapVinted(JSON.parse(fx('vinted.json')));
  assert.equal(items.length, 4);
  assert.equal(items[0].title, 'Nike Dunk Low Panda UK9');
  assert.equal(items[0].price, 62);
  assert.equal(items[1].price, 78); // legacy string price
  assert.equal(items[0].engagement.favourites, 24);
  assert.ok(items[0].url.startsWith('https://www.vinted.co.uk/items/'));
});

test('eBay no-key scraper parses search HTML, skips template + dedups', () => {
  const items = parseEbaySearch(fx('ebay-search.html'));
  // 6 <li> but one is "Shop on eBay" template and one is a duplicate URL -> 4 real
  assert.equal(items.length, 4);
  assert.ok(items.every(i => i.source === 'ebay' && i.url.includes('/itm/')));
  const boxed = items.find(i => i.url.endsWith('/itm/1201'));
  assert.equal(boxed.price, 315);
  assert.equal(boxed.condition, 'Used');
  assert.equal(boxed.image, 'https://i.ebayimg.com/1201.jpg');
  assert.ok(!items.some(i => /Shop on eBay/i.test(i.title)));
});

test('Gumtree parser extracts cards from server HTML', () => {
  const items = parseGumtree(fx('gumtree.html'));
  assert.equal(items.length, 4);
  assert.equal(items[0].price, 375);
  assert.equal(items[0].location, 'Leeds');
  assert.ok(items[0].url.startsWith('https://www.gumtree.com/p/'));
});

test('Facebook card text parser splits price/title/location', () => {
  const card = mapFbCard({ href: 'https://www.facebook.com/marketplace/item/9001', txt: '£120\nDyson V11 Absolute vacuum\nCroydon', img: 'x.jpg' });
  assert.equal(card.price, 120);
  assert.equal(card.title, 'Dyson V11 Absolute vacuum');
  assert.equal(card.location, 'Croydon');
});

test('valuation: band from distribution, gaps and scores', () => {
  const items = mapEbay(JSON.parse(fx('ebay.json')));
  const band = buildBand(items);
  assert.ok(band && band.mid > 300 && band.mid < 420, `band.mid=${band?.mid}`);
  const scored = scoreScan(items);
  // The cheap boxed card (310) should out-score the pricier ones.
  const cheap = scored.find(i => i.id === 'ebay:v1|1101|0');
  const pricey = scored.find(i => i.id === 'ebay:v1|1105|0');
  assert.ok(cheap.valuation.score > pricey.valuation.score);
  assert.ok(cheap.valuation.gapPct > 0, 'cheap item is under the band');
  // price-gap component is measured, and points sum to score
  const sum = cheap.valuation.parts.reduce((s, p) => s + p.points, 0);
  assert.ok(Math.abs(sum - cheap.valuation.score) < 1.5);
  assert.equal(cheap.valuation.parts.find(p => p.key === 'gap').measured, true);
});

test('normalize rejects junk (no price / no url)', () => {
  assert.equal(normalize('ebay', { title: 'x', url: 'u' }), null);
  assert.equal(normalize('ebay', { title: 'x', price: 10 }), null);
  assert.ok(normalize('ebay', { title: 'ok item', url: 'https://x', price: 10 }));
});

test('cross-source scan merges and ranks', () => {
  const a = mapEbay(JSON.parse(fx('ebay.json')));
  const b = mapVinted(JSON.parse(fx('vinted.json')));
  const scored = scoreScan([...a, ...b]).sort((x, y) => y.valuation.score - x.valuation.score);
  assert.equal(scored.length, 9);
  assert.ok(scored[0].valuation.score >= scored[scored.length - 1].valuation.score);
});
