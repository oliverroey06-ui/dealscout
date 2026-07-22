// Live valuation + deal scoring.
//
// We do NOT invent sold-price history. The value band for a query is built from
// the live distribution of comparable listings returned by the scan itself, so
// every number traces back to a real listing you can open. Each score component
// is tagged `measured` (derived from real data) or `estimated` (a neutral proxy
// where the source exposes nothing to measure), and the API returns those tags
// so the UI can be honest about what is real.

const WEIGHTS = {
  gap:        { w: 0.45, label: 'Price gap vs live band' },
  seller:     { w: 0.20, label: 'Seller quality' },
  listing:    { w: 0.20, label: 'Listing completeness' },
  engagement: { w: 0.15, label: 'Demand signal' }
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const i = (sortedAsc.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (i - lo);
}

// Build one value band per (source-agnostic) query result set.
// Comparable population = all listings in the same scan within a sane price window
// of the whole set's median, so a single silly outlier can't distort the band.
export function buildBand(listings) {
  const prices = listings.map(l => toGBP(l)).filter(n => n != null && n > 0).sort((a, b) => a - b);
  if (prices.length < 4) return null; // not enough comps to value against
  const med = percentile(prices, 0.5);
  const trimmed = prices.filter(p => p >= med * 0.35 && p <= med * 2.5);
  const pop = trimmed.length >= 4 ? trimmed : prices;
  return {
    lo: percentile(pop, 0.35),
    mid: percentile(pop, 0.5),
    hi: percentile(pop, 0.75),
    n: pop.length
  };
}

// Rough GBP conversion only for building a shared band when a scan mixes
// currencies (mostly it won't). Deliberately approximate; flagged in the UI.
const TO_GBP = { GBP: 1, EUR: 0.85, USD: 0.79, CAD: 0.58, AUD: 0.52, JPY: 0.0052 };
function toGBP(l) {
  const r = TO_GBP[l.currency] ?? 1;
  return l.price * r;
}

function sellerSignal(l) {
  if (l.seller?.ratingPct != null) {
    // 95%..100% -> 0..1, below 95% ramps down hard
    return { n: clamp01((l.seller.ratingPct - 95) / 5), measured: true };
  }
  return { n: 0.5, measured: false };
}

const BAD_CONDITION = /\b(for parts|spares|repair|faulty|broken|not working|damaged|cracked|as[- ]is)\b/i;

function listingSignal(l) {
  // Completeness we can actually observe: has photo, condition stated,
  // a descriptive (non-truncated-junk) title, seller identity present.
  let s = 0;
  s += l.image ? 0.4 : 0;
  s += l.condition ? 0.25 : 0;
  s += (l.title && l.title.length >= 18) ? 0.2 : 0;
  s += l.seller?.name ? 0.15 : 0;
  // A stated "for parts / faulty" condition is a real negative signal — a low
  // price on a broken item is not a deal. Applies whether the phrase is in the
  // condition field or the title.
  if (BAD_CONDITION.test((l.condition || '') + ' ' + (l.title || ''))) s *= 0.35;
  return { n: clamp01(s), measured: true };
}

function engagementSignal(l, maxEng) {
  const e = l.engagement?.favourites ?? l.engagement?.watchers;
  if (e != null && maxEng > 0) {
    return { n: clamp01(Math.sqrt(e / maxEng)), measured: true };
  }
  return { n: 0.5, measured: false };
}

// Score one listing against a band + the scan-wide max engagement.
export function scoreListing(l, band, maxEng) {
  const priceGBP = toGBP(l);
  let gapPct = null, gapN = 0.5, gapMeasured = false;
  if (band && band.mid > 0) {
    gapPct = (band.mid - priceGBP) / band.mid;          // + = under the band
    gapN = clamp01((gapPct + 0.05) / 0.35);             // -5%..+30% -> 0..1
    gapMeasured = true;
  }
  const seller = sellerSignal(l);
  const listing = listingSignal(l);
  const eng = engagementSignal(l, maxEng);

  const parts = [
    { key: 'gap',        label: WEIGHTS.gap.label,        weight: WEIGHTS.gap.w,        n: gapN,       measured: gapMeasured },
    { key: 'seller',     label: WEIGHTS.seller.label,     weight: WEIGHTS.seller.w,     n: seller.n,   measured: seller.measured },
    { key: 'listing',    label: WEIGHTS.listing.label,    weight: WEIGHTS.listing.w,    n: listing.n,  measured: listing.measured },
    { key: 'engagement', label: WEIGHTS.engagement.label, weight: WEIGHTS.engagement.w, n: eng.n,      measured: eng.measured }
  ];
  const score = Math.round(parts.reduce((s, p) => s + p.weight * p.n * 100, 0));
  return {
    score,
    grade: grade(score),
    gapPct: gapPct == null ? null : Math.round(gapPct * 100),
    band,
    parts: parts.map(p => ({ ...p, points: +(p.weight * p.n * 100).toFixed(1) }))
  };
}

export function grade(score) {
  if (score >= 82) return { id: 'strong', label: 'Strong buy' };
  if (score >= 68) return { id: 'good',   label: 'Good' };
  if (score >= 54) return { id: 'fair',   label: 'Fair' };
  return { id: 'weak', label: 'Weak' };
}

// Score a whole scan: build the band from the population, then score each item.
export function scoreScan(listings) {
  const band = buildBand(listings);
  const engVals = listings.map(l => l.engagement?.favourites ?? l.engagement?.watchers).filter(v => v != null);
  const maxEng = engVals.length ? Math.max(...engVals) : 0;
  return listings.map(l => ({ ...l, valuation: scoreListing(l, band, maxEng) }));
}
