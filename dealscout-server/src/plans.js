// Subscription tiers and the limits that gate real features.
//
// Only features that actually EXIST today are enforced here. Rows from the
// pricing matrix that need infrastructure we don't have yet (historical pricing,
// trend analytics, profit predictions, real timed-alert delivery) are listed as
// `comingSoon` so the UI can show them per-tier honestly without pretending they
// are powered.

// Marketplace groupings. "core" is available to everyone; "premium" (genuine
// resale connectors) unlocks on Elite. Facebook stays a special local-only case.
export const CORE_SOURCES = ['ebay', 'vinted', 'gumtree', 'shpock'];
export const PREMIUM_SOURCES = ['stockx', 'depop', 'grailed', 'vestiaire', 'preloved'];

export const PLANS = {
  free: {
    id: 'free', name: 'Free', price: 0, priceLabel: 'Free',
    watchlist: 5,
    savedSearches: 3,
    scoresPerDay: 10,           // "AI deal scores 10/day"
    sources: 'core',
    advancedFilters: false,
    exportData: false,
    ads: true,
    alertDelayLabel: '1 hour',
    comingSoon: [],
  },
  pro: {
    id: 'pro', name: 'Pro', price: 9.99, priceLabel: '£9.99/mo',
    watchlist: 50,
    savedSearches: 25,
    scoresPerDay: Infinity,
    sources: 'core',
    advancedFilters: true,
    exportData: false,
    ads: false,
    alertDelayLabel: '5 minutes',
    comingSoon: ['historicalPricing'],
  },
  elite: {
    id: 'elite', name: 'Elite', price: 24.99, priceLabel: '£24.99/mo',
    watchlist: Infinity,
    savedSearches: Infinity,
    scoresPerDay: Infinity,
    sources: 'all',             // core + premium resale connectors
    advancedFilters: true,
    exportData: true,
    ads: false,
    alertDelayLabel: 'instant',
    comingSoon: ['historicalPricing', 'trendAnalytics', 'profitPredictions'],
  },
};

export const TRIAL = {
  plan: 'pro',        // a phone-verified free trial grants Pro-level access
  days: 7,
  oncePerPhone: true, // enforced via SMS verification at signup
};

export function planOf(id) { return PLANS[id] || PLANS.free; }

const RANK = { free: 0, pro: 1, elite: 2 };

// The tier a user effectively has right now = the best of their paid
// subscription and any active phone-verified trial. Computed on the fly so no
// cron job is needed to expire trials.
export function activePlanId(user) {
  if (!user) return 'free';
  const subActive = ['active', 'trialing', 'past_due'].includes(user.subscriptionStatus);
  const subPlan = subActive ? (user.plan || 'free') : 'free';
  const trialPlan = (user.trialEndsAt && Date.now() < user.trialEndsAt) ? TRIAL.plan : 'free';
  return (RANK[subPlan] ?? 0) >= (RANK[trialPlan] ?? 0) ? subPlan : trialPlan;
}

// Is the user currently inside a phone-verified trial (and not paying)?
export function onTrial(user) {
  return !!(user?.trialEndsAt && Date.now() < user.trialEndsAt &&
    !['active', 'past_due'].includes(user.subscriptionStatus));
}

// Which source ids a plan may scan.
export function allowedSources(planId, allSourceIds) {
  const plan = planOf(planId);
  if (plan.sources === 'all') return allSourceIds.slice();
  return allSourceIds.filter(id => CORE_SOURCES.includes(id));
}

export function isPremiumSource(id) { return PREMIUM_SOURCES.includes(id); }

// Central limit lookup used by the gating middleware.
export function limit(planId, key) { return planOf(planId)[key]; }
