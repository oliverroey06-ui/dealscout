# DealScout

A real marketplace deal scanner. Type a product, and DealScout searches several
UK marketplaces at once, scores every listing against a **live value band** built
from the listings in that same scan, and ranks the best deals first — each with a
real link straight to the source.

This is the working service behind the earlier single-file demo. It is a small
Node server you can run locally or deploy to a host.

```
 ┌─ browser UI ─┐        ┌──────── DealScout server ────────┐
 │ search + scan│ ─────▶ │  /api/scan                       │
 └──────────────┘        │   ├─ eBay      (official API)     │ ─▶ eBay
        ▲                │   ├─ Vinted    (unofficial)      │ ─▶ Vinted
        │  scored,       │   ├─ Gumtree   (unofficial)      │ ─▶ Gumtree
        └── ranked ──────│   ├─ Shpock    (unofficial)      │ ─▶ Shpock
           listings      │   └─ Facebook  (browser, opt-in) │ ─▶ FB Marketplace
                         │  → merge → value band → score    │
                         └──────────────────────────────────┘
```

---

## The one thing to understand first

Only **eBay** offers a real, sanctioned API. The other marketplaces have **no
public API**, so DealScout reaches them by **unofficial scraping**, which:

- **breaks those sites' Terms of Service**, and
- **is fragile** — it can stop working whenever a site changes its markup or
  tightens anti-bot protection (Facebook especially, which is login-walled).

Each source is **independent and individually toggleable**. If a scraper breaks,
turn it off; the others keep working. eBay is the dependable anchor and is the
one source that will keep running indefinitely.

DealScout **does not invent data**. The value band for a scan is computed from
the real distribution of comparable listings that scan returned, so every number
traces back to a listing you can open. Score components that a source doesn't
expose are shown as **estimated**, never faked.

---

## Quick start (local)

Requires Node 20+.

```bash
npm install
cp .env.example .env        # then add your eBay keys (see below)
npm start                   # → http://localhost:8080
```

Open the URL, type e.g. `rtx 3080`, pick your sources, hit **Scan**.

It runs **without** eBay keys too — you just lose the reliable source and run on
the scrapers only. Add the keys to get the dependable one.

### Getting free eBay keys (5 minutes)

1. Sign in at **https://developer.ebay.com** and create a developer account.
2. Create an application keyset and copy the **Production** *App ID* and
   *Cert ID*.
3. Put them in `.env`:
   ```
   EBAY_CLIENT_ID=YourAppId-xxxx-xxxx
   EBAY_CLIENT_SECRET=PRD-xxxxxxxxxxxx
   EBAY_MARKETPLACE=EBAY_GB
   ```
That's it — the eBay connector handles the OAuth token itself.

---

## Deploy (cloud)

You chose a deployed, always-on service. Any Node host works. Two easy paths:

### Render (blueprint included)

1. Push this folder to a GitHub repo.
2. Render → **New → Blueprint** → pick the repo (`render.yaml` is already here).
3. In the dashboard, set `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`.
4. Deploy. Health check is at `/api/health`.

### Docker (any host: Fly, Railway, a VPS, etc.)

```bash
docker build -t dealscout .
docker run -p 8080:8080 --env-file .env dealscout
```

### ⚠️ The cloud caveat for the four scrapers

Marketplaces block **datacenter / cloud IPs** far faster than home connections.
eBay (official API) is unaffected. The four scrapers may work intermittently or
get blocked outright from a cloud host. Options, in order of effort:

- Run the scrapers through a **residential proxy** (set `HTTPS_PROXY` for the
  process, or add a proxy agent per connector).
- Keep **eBay on in the cloud** (rock solid) and run the **scrapers from a
  machine on a home connection** when you need them.
- Accept that scraper hit-rates are lower from the cloud and lean on eBay.

This is a property of the marketplaces, not of DealScout — no code change makes a
datacenter IP look residential.

---

## Accounts, tiers & billing (SaaS mode)

DealScout ships with a full account layer that stays **dormant until you turn it
on**. With no database configured the server runs in **open mode** — the scanner
is public, exactly like the demo. Set a `DATABASE_URL` (or `AUTH_FORCE=1` for a
local in-memory trial) and the same server becomes a real multi-tenant SaaS: a
marketing home page, sign-up / login (email + password **and** Google), per-plan
limits, Stripe subscriptions, and a phone-verified free trial.

```
open mode  (no DATABASE_URL)        SaaS mode  (DATABASE_URL set)
──────────────────────────────      ──────────────────────────────────
/         scanner (public)          /          marketing home
                                    /login     email+password / Google
                                    /app       scanner (needs an account)
                                    /account   plan, billing, trial
```

### The three plans

| | Free | Pro — £9.99/mo | Elite — £24.99/mo |
|---|---|---|---|
| Marketplaces | core (eBay, Vinted, Gumtree, Shpock) | core | **all** (+ Depop, StockX, Grailed, Vestiaire, Preloved) |
| Watchlist | 5 | 50 | unlimited |
| Saved searches | 3 | 25 | unlimited |
| AI deal scores / day | 10 | unlimited | unlimited |
| Advanced filters | — | ✓ | ✓ |
| Data export | — | — | ✓ |
| Ads | shown | hidden | hidden |

Limits are **enforced on the server** (`src/plans.js`) — the UI reflects them but
can't grant them. `activePlanId(user)` resolves the best of a paid subscription
and any live trial, so gating is a single call everywhere it's needed.

### Free 7-day Pro trial (phone-verified, once per number)

A logged-in free user can claim a **7-day Pro trial** from `/account`, gated by
an **SMS one-time code** (Twilio Verify). The phone number is **hashed (SHA-256)
before storage** — the raw number is never kept — and that hash is what blocks a
second trial from the same number. No card required.

### Going live — four free services

| Service | Why | Env vars |
|---|---|---|
| **Neon** (Postgres) | accounts + watchlist persistence; flips SaaS mode on | `DATABASE_URL` |
| **Stripe** | Pro / Elite subscriptions, billing portal, webhooks | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ELITE` |
| **Google OAuth** | "Continue with Google" sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| **Twilio Verify** | the phone-verified trial | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` |

Every one has a free tier, and each block is **independent**: set only Neon and
you get accounts with no billing (the upgrade buttons simply hide); add Stripe
when you're ready to charge; add Google and Twilio whenever you like. Also set a
long random `SESSION_SECRET` in production — sessions are stateless, HMAC-signed
cookies. `.env.example` lists every variable.

---

## Sources & status

| Source          | Method                     | Tier    | Reliability |
|-----------------|----------------------------|---------|-------------|
| eBay            | Official API (keys) / scrape | core  | ★★★★★ with keys · scrape blocked from cloud IPs |
| Vinted          | Internal JSON endpoint     | core    | ★★★ works until they rotate anti-bot |
| Gumtree         | Server-HTML scrape         | core    | ★★★ selector-dependent |
| Shpock          | Embedded JSON / HTML       | core    | ★★ most likely to need updates |
| Depop           | Internal search JSON       | premium | ★★★ best-effort |
| StockX          | Browse JSON                | premium | ★ heavily bot-protected (needs residential IP / official API) |
| Grailed         | Algolia (public keys)      | premium | ★★ needs GRAILED_ALGOLIA_* keys |
| Vestiaire       | Search API                 | premium | ★ undocumented, best-effort |
| Preloved        | Server-HTML scrape         | premium | ★★★ best-effort |
| FB Marketplace  | Playwright, logged-in      | **off** | ★ fragile, ToS, needs a session |

`core` sources are available on every plan; `premium` resale connectors unlock on
**Elite**. All are genuine second-hand/resale marketplaces for authentic goods.
Like eBay's scrape path, the premium connectors are bot-protected and will often
be blocked from a datacenter IP — they work best from a residential connection or
via each site's official API.

The UI shows a live status pill per source after each scan (count or error), so
you always know which ones responded.

### Facebook Marketplace (optional, off by default)

Meta has no Marketplace API. The only route is a real logged-in browser, which is
fragile and against Facebook's ToS. To try it:

```bash
npm i playwright && npx playwright install chromium
node scripts/facebook-login.js     # log in once → saves fb-state.json
# in .env:
FACEBOOK_ENABLED=1
FACEBOOK_STATE=./fb-state.json
FACEBOOK_CITY=london
```

Facebook will still challenge automated sessions periodically. Treat any result
as best-effort and turn it off if it misbehaves — it never affects the others.

---

## How the deal score works

A 0–100 score from four weighted signals:

| Signal | Weight | Source of truth |
|---|---|---|
| **Price gap vs live band** | 45% | `(band mid − price) / band mid`, measured |
| **Seller quality** | 20% | eBay feedback %, else estimated |
| **Listing completeness** | 20% | photo, condition, title, seller present; penalised for "for parts / faulty" |
| **Demand signal** | 15% | Vinted favourites etc. where exposed, else estimated |

The **value band** is the 35th–75th percentile of the comparable listings in the
scan (median-trimmed to drop wild outliers). The drawer shows the band, the
weighted breakdown with each signal tagged measured/estimated, and the live
comparables — every one a real, clickable listing.

Weights live in `src/valuation.js` — tune them to taste.

---

## API

```
GET /api/sources
  → { sources: [{ id, label, kind, ready, note, enabled }] }

GET /api/scan?q=<query>&sources=<csv>&limit=<n>&fresh=1
  → { ok, query, ms, count, band,
      sources: [{ source, ok, count, ms, error }],
      listings: [{ id, source, title, url, image, price, currency,
                   condition, location, seller, engagement,
                   valuation: { score, grade, gapPct, band, parts:[…] } }] }

GET /api/health → { ok, uptime }

# SaaS mode adds these (JSON; auth via the ds_session cookie):
GET  /api/config · /api/plans · /api/me
POST /api/auth/signup · /api/auth/login · /api/auth/logout
GET  /api/auth/google · /api/auth/google/callback
POST /api/billing/checkout · /api/billing/portal · /api/stripe/webhook
POST /api/trial/send · /api/trial/verify
GET/POST/DELETE /api/watchlist · /api/saved-searches
```

`sources` defaults to all enabled. Unknown sources are ignored. Identical scans
are cached for `CACHE_TTL_MS`; add `&fresh=1` to bypass. In SaaS mode `/api/scan`
also requires a session and enforces the plan's daily-score and source limits
(`401` when logged out, `402` when over a limit).

---

## Project layout

```
src/
  server.js              Express app, /api routes, auth-gating, static pages
  plans.js               tiers + per-plan limits + activePlanId() gating
  store.js               data layer — Postgres (Neon) or in-memory, one API
  auth.js                scrypt passwords, signed session cookies, Google OAuth
  billing.js             Stripe checkout, billing portal, webhook sync
  verify.js              Twilio Verify — phone-verified trial (hashed numbers)
  valuation.js           value band + deal scoring
  normalize.js           common listing schema + helpers
  cache.js               TTL cache
  connectors/
    index.js             registry, toggles, isolated per-source runner
    ebay.js              official Browse API (OAuth) + no-key scrape fallback
    vinted.js            internal JSON API + cookie bootstrap
    gumtree.js           HTML scrape (cheerio)
    shpock.js            embedded-JSON / DOM scrape
    depop.js             internal search JSON            (premium)
    stockx.js            browse JSON                     (premium)
    grailed.js           Algolia public keys             (premium)
    vestiaire.js         search API                      (premium)
    preloved.js          HTML scrape                     (premium)
    facebook.js          Playwright, opt-in
public/
  home.html              marketing landing (SaaS mode)
  auth.html              login / sign-up (email + Google)
  index.html             the scanner UI (one file, no build step)
  account.html           plan, billing, trial
test/                    parser + valuation units, API + SaaS + UI integration
scripts/facebook-login.js
Dockerfile, render.yaml, .env.example
```

## Tests

```bash
npm test          # parser + valuation units, live API integration, UI drive
```

The suite runs entirely offline against fixtures and a mock marketplace — it
proves the parsing, scoring and API contract without hitting real sites. The
live scrapers can only be validated against the real sites from your deployment.

## Adding a marketplace

1. Create `src/connectors/<name>.js` exporting `meta` and
   `search({ query, limit, env, signal })` returning listings via
   `normalize('<name>', {...})`.
2. Register it in `src/connectors/index.js`.
That's the whole contract — scoring, the UI, and status all pick it up.

## Honest limitations

- Scraper hit-rate and longevity depend on the marketplaces, not on this code.
- A scan assumes its results are comparables for one product — search a specific
  product (`fender player stratocaster`), not a vague category (`guitar`), for a
  meaningful value band.
- Persistence is real in SaaS mode (Postgres/Neon) and per-session in open mode.
  Saved-search **alerts** — a background re-scan that notifies you when a deal
  appears — are the natural next step; the saved searches themselves already
  persist.
- Respect each marketplace's terms and rate limits. This tool is for personal
  deal-finding; don't hammer the sources.
