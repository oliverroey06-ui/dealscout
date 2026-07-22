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

Only **eBay** offers a real, sanctioned API. The other four have **no public
API**, so DealScout reaches them by **unofficial scraping**, which:

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

## Sources & status

| Source          | Method                     | Default | Reliability |
|-----------------|----------------------------|---------|-------------|
| eBay            | Official Browse API        | on      | ★★★★★ stable, sanctioned |
| Vinted          | Internal JSON endpoint     | on      | ★★★ works until they rotate anti-bot |
| Gumtree         | Server-HTML scrape         | on      | ★★★ selector-dependent |
| Shpock          | Embedded JSON / HTML       | on      | ★★ most likely to need updates |
| FB Marketplace  | Playwright, logged-in      | **off** | ★ fragile, ToS, needs a session |

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
```

`sources` defaults to all enabled. Unknown sources are ignored. Identical scans
are cached for `CACHE_TTL_MS`; add `&fresh=1` to bypass.

---

## Project layout

```
src/
  server.js              Express app + /api routes + static UI
  valuation.js           value band + deal scoring
  normalize.js           common listing schema + helpers
  cache.js               TTL cache
  connectors/
    index.js             registry, toggles, isolated per-source runner
    ebay.js              official Browse API (OAuth handled)
    vinted.js            internal JSON API + cookie bootstrap
    gumtree.js           HTML scrape (cheerio)
    shpock.js            embedded-JSON / DOM scrape
    facebook.js          Playwright, opt-in
public/index.html        the scanner UI (one file, no build step)
test/                    parser + valuation unit tests, API + UI integration
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
- No persistence yet: the watchlist lives in the browser session. Wiring a small
  datastore + saved-search alerts is the natural next step.
- Respect each marketplace's terms and rate limits. This tool is for personal
  deal-finding; don't hammer the sources.
