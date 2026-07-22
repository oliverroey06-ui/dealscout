// Tiny in-memory TTL cache so repeated scans of the same query within a short
// window don't hammer the marketplaces (and get you rate-limited / blocked).

export class TTLCache {
  constructor(ttlMs = 90_000, max = 200) { this.ttl = ttlMs; this.max = max; this.map = new Map(); }
  get(key) {
    const e = this.map.get(key);
    if (!e) return null;
    if (Date.now() > e.exp) { this.map.delete(key); return null; }
    return e.val;
  }
  set(key, val) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { val, exp: Date.now() + this.ttl });
  }
}
