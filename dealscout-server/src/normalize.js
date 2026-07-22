// Common listing schema every connector emits, plus helpers.
//
// A normalized listing:
// {
//   id, source, title, rawTitle, url, image,
//   price (number, in `currency`), currency, shipping (number|null),
//   condition (string|null), location (string|null),
//   postedAt (ms epoch|null), auctionEndsInMin (number|null),
//   seller: { name, ratingPct(0-100|null), sales(number|null) },
//   engagement: { favourites(number|null), watchers(number|null) },
//   hasDescription (bool)
// }

export const SOURCES = ['ebay', 'vinted', 'gumtree', 'shpock', 'facebook'];

export const SOURCE_META = {
  ebay:     { label: 'eBay',             kind: 'api',    tos: 'official API' },
  vinted:   { label: 'Vinted',           kind: 'scrape', tos: 'unofficial' },
  gumtree:  { label: 'Gumtree',          kind: 'scrape', tos: 'unofficial' },
  shpock:   { label: 'Shpock',           kind: 'scrape', tos: 'unofficial' },
  facebook: { label: 'FB Marketplace',   kind: 'browser', tos: 'unofficial' }
};

// A defensive currency-string parser: "£415.00", "1,234.5", "GBP 20" -> number
export function parseMoney(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const m = String(v).replace(/[^0-9.,]/g, '').replace(/,(?=\d{3}\b)/g, '');
  const n = parseFloat(m.replace(/,/g, '.'));
  return isFinite(n) ? n : null;
}

export function detectCurrency(v, fallback = 'GBP') {
  if (!v) return fallback;
  const s = String(v);
  if (s.includes('£') || /\bGBP\b/i.test(s)) return 'GBP';
  if (s.includes('€') || /\bEUR\b/i.test(s)) return 'EUR';
  if (s.includes('$') || /\bUSD\b/i.test(s)) return 'USD';
  return fallback;
}

const CUR_SYMBOL = { GBP: '£', EUR: '€', USD: '$', CAD: 'C$', AUD: 'A$', JPY: '¥' };
export function fmtMoney(n, cur = 'GBP') {
  if (n == null || !isFinite(n)) return '—';
  const sym = CUR_SYMBOL[cur] || (cur + ' ');
  return sym + Math.round(n).toLocaleString('en-GB');
}

// Guarantee every field exists and is the right type. Never throw.
export function normalize(source, raw) {
  const price = parseMoney(raw.price);
  if (price == null || price <= 0) return null;
  if (!raw.url || !raw.title) return null;
  return {
    id: source + ':' + (raw.id != null ? String(raw.id) : hash(raw.url)),
    source,
    title: clean(String(raw.title)).slice(0, 140),
    rawTitle: raw.rawTitle ? String(raw.rawTitle).slice(0, 200) : null,
    url: String(raw.url),
    image: raw.image ? String(raw.image) : null,
    price,
    currency: raw.currency || 'GBP',
    shipping: raw.shipping == null ? null : parseMoney(raw.shipping),
    condition: raw.condition ? String(raw.condition).slice(0, 30) : null,
    location: raw.location ? String(raw.location).slice(0, 40) : null,
    postedAt: typeof raw.postedAt === 'number' ? raw.postedAt : null,
    auctionEndsInMin: typeof raw.auctionEndsInMin === 'number' ? raw.auctionEndsInMin : null,
    seller: {
      name: raw.seller?.name ? String(raw.seller.name).slice(0, 40) : null,
      ratingPct: numOrNull(raw.seller?.ratingPct),
      sales: numOrNull(raw.seller?.sales)
    },
    engagement: {
      favourites: numOrNull(raw.engagement?.favourites),
      watchers: numOrNull(raw.engagement?.watchers)
    },
    hasDescription: !!raw.hasDescription
  };
}

function clean(s) { return s.replace(/\s+/g, ' ').trim(); }
function numOrNull(v) {
  if (v == null || v === '') return null;   // Number(null) === 0 — guard it
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
