// Data layer. One async interface, two adapters:
//   • memory  — dev, tests, and the "no database configured yet" fallback.
//   • postgres — production (Neon free tier), selected when DATABASE_URL is set.
//
// Persistence matters here (accounts, subscriptions), and a Render free web
// service has an EPHEMERAL disk, so production MUST use an external Postgres.
// The memory adapter is only for local/dev and never persists.

import { randomUUID } from 'node:crypto';

export async function createStore(env) {
  if (env.DATABASE_URL) {
    const s = await pgStore(env.DATABASE_URL);
    await s.init();
    return s;
  }
  return memoryStore();
}

// ---------------- in-memory ----------------
function memoryStore() {
  const users = new Map();          // id -> user
  const byEmail = new Map();        // email -> id
  const byGoogle = new Map();       // googleId -> id
  const watch = new Map();          // userId -> Map(itemId -> row)
  const searches = new Map();       // userId -> Map(id -> row)
  const usage = new Map();          // `${userId}:${day}` -> count
  const trials = new Map();         // phoneHash -> { userId, at }

  const u = (id) => users.get(id) || null;
  return {
    kind: 'memory',
    async init() {},
    users: {
      async create({ email, name, passwordHash = null, googleId = null, plan = 'free' }) {
        const id = randomUUID();
        const user = { id, email: email.toLowerCase(), name: name || null, passwordHash, googleId,
          plan, stripeCustomerId: null, subscriptionStatus: null, currentPeriodEnd: null,
          trialEndsAt: null, phoneHash: null, createdAt: Date.now() };
        users.set(id, user); byEmail.set(user.email, id);
        if (googleId) byGoogle.set(googleId, id);
        return { ...user };
      },
      async byEmail(email) { const id = byEmail.get((email || '').toLowerCase()); return id ? { ...u(id) } : null; },
      async byId(id) { return u(id) ? { ...u(id) } : null; },
      async byGoogleId(gid) { const id = byGoogle.get(gid); return id ? { ...u(id) } : null; },
      async byStripeCustomer(cid) { for (const user of users.values()) if (user.stripeCustomerId === cid) return { ...user }; return null; },
      async update(id, patch) {
        const user = u(id); if (!user) return null;
        Object.assign(user, patch);
        if (patch.googleId) byGoogle.set(patch.googleId, id);
        return { ...user };
      },
    },
    watchlist: {
      async list(userId) { return [...(watch.get(userId)?.values() || [])]; },
      async count(userId) { return watch.get(userId)?.size || 0; },
      async add(userId, item, targetPrice = null) {
        if (!watch.has(userId)) watch.set(userId, new Map());
        const row = { id: item.id, item, targetPrice, createdAt: Date.now() };
        watch.get(userId).set(item.id, row); return row;
      },
      async remove(userId, itemId) { watch.get(userId)?.delete(itemId); },
    },
    savedSearches: {
      async list(userId) { return [...(searches.get(userId)?.values() || [])]; },
      async count(userId) { return searches.get(userId)?.size || 0; },
      async add(userId, { query, sources, filters }) {
        if (!searches.has(userId)) searches.set(userId, new Map());
        const id = randomUUID();
        const row = { id, query, sources: sources || [], filters: filters || {}, createdAt: Date.now() };
        searches.get(userId).set(id, row); return row;
      },
      async remove(userId, id) { searches.get(userId)?.delete(id); },
    },
    usage: {
      async bump(userId, day) { const k = `${userId}:${day}`; const n = (usage.get(k) || 0) + 1; usage.set(k, n); return n; },
      async get(userId, day) { return usage.get(`${userId}:${day}`) || 0; },
    },
    trials: {
      async usedByPhone(phoneHash) { return trials.has(phoneHash); },
      async markUsed(phoneHash, userId) { trials.set(phoneHash, { userId, at: Date.now() }); },
    },
  };
}

// ---------------- postgres ----------------
async function pgStore(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 5 });
  const q = (text, params) => pool.query(text, params);
  const rowToUser = (r) => r && ({
    id: r.id, email: r.email, name: r.name, passwordHash: r.password_hash, googleId: r.google_id,
    plan: r.plan, stripeCustomerId: r.stripe_customer_id, subscriptionStatus: r.subscription_status,
    currentPeriodEnd: r.current_period_end == null ? null : Number(r.current_period_end),
    trialEndsAt: r.trial_ends_at == null ? null : Number(r.trial_ends_at),
    phoneHash: r.phone_hash, createdAt: Number(r.created_at),
  });
  const USER_COLS = { name: 'name', passwordHash: 'password_hash', googleId: 'google_id', plan: 'plan',
    stripeCustomerId: 'stripe_customer_id', subscriptionStatus: 'subscription_status',
    currentPeriodEnd: 'current_period_end', trialEndsAt: 'trial_ends_at', phoneHash: 'phone_hash' };

  return {
    kind: 'postgres',
    async init() {
      await q(`CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY, email text UNIQUE NOT NULL, name text,
        password_hash text, google_id text UNIQUE, plan text NOT NULL DEFAULT 'free',
        stripe_customer_id text, subscription_status text, current_period_end bigint,
        trial_ends_at bigint, phone_hash text, created_at bigint NOT NULL)`);
      await q(`CREATE TABLE IF NOT EXISTS watchlist (
        user_id uuid NOT NULL, item_id text NOT NULL, item jsonb NOT NULL,
        target_price numeric, created_at bigint NOT NULL, PRIMARY KEY (user_id, item_id))`);
      await q(`CREATE TABLE IF NOT EXISTS saved_searches (
        id uuid PRIMARY KEY, user_id uuid NOT NULL, query text NOT NULL,
        sources text[] NOT NULL DEFAULT '{}', filters jsonb NOT NULL DEFAULT '{}', created_at bigint NOT NULL)`);
      await q(`CREATE TABLE IF NOT EXISTS usage_daily (
        user_id uuid NOT NULL, day text NOT NULL, scans int NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))`);
      await q(`CREATE TABLE IF NOT EXISTS trials (
        phone_hash text PRIMARY KEY, user_id uuid, created_at bigint NOT NULL)`);
    },
    users: {
      async create({ email, name, passwordHash = null, googleId = null, plan = 'free' }) {
        const id = randomUUID();
        const { rows } = await q(
          `INSERT INTO users (id,email,name,password_hash,google_id,plan,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [id, email.toLowerCase(), name || null, passwordHash, googleId, plan, Date.now()]);
        return rowToUser(rows[0]);
      },
      async byEmail(email) { const { rows } = await q('SELECT * FROM users WHERE email=$1', [(email || '').toLowerCase()]); return rowToUser(rows[0]); },
      async byId(id) { const { rows } = await q('SELECT * FROM users WHERE id=$1', [id]); return rowToUser(rows[0]); },
      async byGoogleId(gid) { const { rows } = await q('SELECT * FROM users WHERE google_id=$1', [gid]); return rowToUser(rows[0]); },
      async byStripeCustomer(cid) { const { rows } = await q('SELECT * FROM users WHERE stripe_customer_id=$1', [cid]); return rowToUser(rows[0]); },
      async update(id, patch) {
        const sets = [], vals = []; let i = 1;
        for (const [k, col] of Object.entries(USER_COLS)) if (k in patch) { sets.push(`${col}=$${i++}`); vals.push(patch[k]); }
        if (!sets.length) return this.byId(id);
        vals.push(id);
        const { rows } = await q(`UPDATE users SET ${sets.join(',')} WHERE id=$${i} RETURNING *`, vals);
        return rowToUser(rows[0]);
      },
    },
    watchlist: {
      async list(userId) { const { rows } = await q('SELECT item,target_price FROM watchlist WHERE user_id=$1 ORDER BY created_at DESC', [userId]); return rows.map(r => ({ id: r.item.id, item: r.item, targetPrice: r.target_price })); },
      async count(userId) { const { rows } = await q('SELECT count(*)::int n FROM watchlist WHERE user_id=$1', [userId]); return rows[0].n; },
      async add(userId, item, targetPrice = null) {
        await q(`INSERT INTO watchlist (user_id,item_id,item,target_price,created_at) VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (user_id,item_id) DO UPDATE SET item=$3,target_price=$4`,
          [userId, item.id, item, targetPrice, Date.now()]);
        return { id: item.id, item, targetPrice };
      },
      async remove(userId, itemId) { await q('DELETE FROM watchlist WHERE user_id=$1 AND item_id=$2', [userId, itemId]); },
    },
    savedSearches: {
      async list(userId) { const { rows } = await q('SELECT * FROM saved_searches WHERE user_id=$1 ORDER BY created_at DESC', [userId]); return rows.map(r => ({ id: r.id, query: r.query, sources: r.sources, filters: r.filters, createdAt: Number(r.created_at) })); },
      async count(userId) { const { rows } = await q('SELECT count(*)::int n FROM saved_searches WHERE user_id=$1', [userId]); return rows[0].n; },
      async add(userId, { query, sources, filters }) {
        const id = randomUUID();
        await q('INSERT INTO saved_searches (id,user_id,query,sources,filters,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
          [id, userId, query, sources || [], filters || {}, Date.now()]);
        return { id, query, sources: sources || [], filters: filters || {} };
      },
      async remove(userId, id) { await q('DELETE FROM saved_searches WHERE user_id=$1 AND id=$2', [userId, id]); },
    },
    usage: {
      async bump(userId, day) {
        const { rows } = await q(`INSERT INTO usage_daily (user_id,day,scans) VALUES ($1,$2,1)
          ON CONFLICT (user_id,day) DO UPDATE SET scans=usage_daily.scans+1 RETURNING scans`, [userId, day]);
        return rows[0].scans;
      },
      async get(userId, day) { const { rows } = await q('SELECT scans FROM usage_daily WHERE user_id=$1 AND day=$2', [userId, day]); return rows[0]?.scans || 0; },
    },
    trials: {
      async usedByPhone(phoneHash) { const { rows } = await q('SELECT 1 FROM trials WHERE phone_hash=$1', [phoneHash]); return rows.length > 0; },
      async markUsed(phoneHash, userId) { await q('INSERT INTO trials (phone_hash,user_id,created_at) VALUES ($1,$2,$3) ON CONFLICT (phone_hash) DO NOTHING', [phoneHash, userId, Date.now()]); },
    },
  };
}
