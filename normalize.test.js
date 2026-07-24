import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/normalize.js';

test('null seller rating stays null (not 0) — scraped sources score as estimated', () => {
  const l = normalize('vinted', {
    id: 1, title: 'Nike Dunk Low Panda UK9', url: 'https://x', price: 62,
    seller: { name: 'soleandco', ratingPct: null, sales: null }
  });
  assert.equal(l.seller.ratingPct, null);
  assert.equal(l.seller.sales, null);
});

test('a real rating is preserved', () => {
  const l = normalize('ebay', {
    id: 2, title: 'thing', url: 'https://x', price: 10,
    seller: { name: 's', ratingPct: 99.4, sales: 800 }
  });
  assert.equal(l.seller.ratingPct, 99.4);
  assert.equal(l.seller.sales, 800);
});

test('zero favourites is kept as 0, missing is null', () => {
  const a = normalize('vinted', { id: 3, title: 't', url: 'u://x', price: 5, engagement: { favourites: 0 } });
  const b = normalize('vinted', { id: 4, title: 't', url: 'u://x', price: 5, engagement: {} });
  assert.equal(a.engagement.favourites, 0);
  assert.equal(b.engagement.favourites, null);
});
