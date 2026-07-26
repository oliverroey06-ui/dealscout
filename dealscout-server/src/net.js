// Optional residential-proxy routing for the scraper connectors.
//
// Marketplaces block datacenter/cloud IPs, so a hosted deploy (Render, a VPS)
// gets 403s that a home connection doesn't. Point SCRAPER_PROXY_URL at a
// residential-proxy provider and every *scraper* fetch tunnels through a
// residential IP — so the hosted site returns what a home browser would. The
// official eBay API and the Stripe / Twilio / Google calls never use the proxy;
// only the best-effort scrapers do (which is also all you want to pay proxy
// bandwidth for).
//
//   SCRAPER_PROXY_URL=http://user:pass@gate.provider.com:7777
//   # or keep the auth separate:
//   SCRAPER_PROXY_URL=http://gate.provider.com:7777
//   SCRAPER_PROXY_USERNAME=...
//   SCRAPER_PROXY_PASSWORD=...
//
// With nothing set, scrapeFetch is a normal direct fetch — behaviour unchanged.

import { fetch as undiciFetch, ProxyAgent } from 'undici';

let cache = { key: '', agent: null };

// Opt-in ONLY via SCRAPER_PROXY_URL. We deliberately do NOT honour the generic
// HTTPS_PROXY/https_proxy, so an ambient proxy in the host environment can never
// silently reroute scraper traffic — you turn this on explicitly.
function proxyUri(env) {
  return env.SCRAPER_PROXY_URL || '';
}

export function proxyEnabled(env = process.env) {
  return !!proxyUri(env);
}

// A cached undici ProxyAgent for the configured proxy, or null if none is set.
export function proxyDispatcher(env = process.env) {
  const raw = proxyUri(env);
  if (!raw) return null;
  let uri = raw;
  let user = env.SCRAPER_PROXY_USERNAME || '';
  let pass = env.SCRAPER_PROXY_PASSWORD || '';
  // Pull inline credentials (http://user:pass@host:port) out of the URI so we
  // can send them as Proxy-Authorization, which is what ProxyAgent expects.
  try {
    const u = new URL(raw);
    if (u.username || u.password) {
      user = user || decodeURIComponent(u.username);
      pass = pass || decodeURIComponent(u.password);
      u.username = ''; u.password = '';
      uri = u.toString();
    }
  } catch { /* leave uri as-is */ }
  const key = `${uri}|${user}|${pass}`;
  if (key !== cache.key) {
    const opts = { uri };
    if (user && pass) opts.token = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    cache = { key, agent: new ProxyAgent(opts) };
  }
  return cache.agent;
}

// Drop-in fetch for the scraper connectors: routes through the residential proxy
// when one is configured, otherwise a plain direct fetch (Node's global fetch,
// untouched). Same call shape as fetch, plus the resolved `env`.
export async function scrapeFetch(url, opts = {}, env = process.env) {
  const dispatcher = proxyDispatcher(env);
  if (!dispatcher) return fetch(url, opts);
  return undiciFetch(url, { ...opts, dispatcher });
}
