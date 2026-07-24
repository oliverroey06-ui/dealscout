// Stripe billing. Activates only when STRIPE_SECRET_KEY is set; until then the
// account page shows the plans but the buttons explain billing isn't wired yet.
//
// Money never touches our server: Stripe Checkout (hosted) collects the card,
// and a webhook syncs the subscription state back to the user's plan.

let _stripe = null;
async function stripe(env) {
  if (_stripe) return _stripe;
  const { default: Stripe } = await import('stripe');
  _stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' });
  return _stripe;
}

export function billingConfigured(env) { return !!env.STRIPE_SECRET_KEY; }

// price id -> plan id, from env
function priceMap(env) {
  return {
    [env.STRIPE_PRICE_PRO]: 'pro',
    [env.STRIPE_PRICE_ELITE]: 'elite',
  };
}
function planToPrice(env, planId) {
  return planId === 'elite' ? env.STRIPE_PRICE_ELITE : planId === 'pro' ? env.STRIPE_PRICE_PRO : null;
}

// Ensure the user has a Stripe customer id; create + persist if missing.
async function customerFor(env, store, user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const s = await stripe(env);
  const c = await s.customers.create({ email: user.email, name: user.name || undefined, metadata: { userId: user.id } });
  await store.users.update(user.id, { stripeCustomerId: c.id });
  return c.id;
}

export async function createCheckout(env, store, user, planId, origin) {
  const price = planToPrice(env, planId);
  if (!price) throw new Error('Unknown plan or missing price id');
  const s = await stripe(env);
  const customer = await customerFor(env, store, user);
  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${origin}/account?upgraded=1`,
    cancel_url: `${origin}/account`,
    metadata: { userId: user.id, planId },
  });
  return session.url;
}

export async function createPortal(env, store, user, origin) {
  const s = await stripe(env);
  const customer = await customerFor(env, store, user);
  const session = await s.billingPortal.sessions.create({ customer, return_url: `${origin}/account` });
  return session.url;
}

// Verify + handle a webhook event. Returns a short status string.
export async function handleWebhook(env, store, rawBody, signature) {
  const s = await stripe(env);
  const event = s.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  const map = priceMap(env);

  const syncFromSubscription = async (sub) => {
    const customerId = sub.customer;
    const user = await findUserByCustomer(store, customerId);
    if (!user) return 'no user';
    const active = ['active', 'trialing', 'past_due'].includes(sub.status);
    const priceId = sub.items?.data?.[0]?.price?.id;
    const plan = active ? (map[priceId] || 'pro') : 'free';
    await store.users.update(user.id, {
      plan,
      subscriptionStatus: sub.status,
      currentPeriodEnd: sub.current_period_end ? sub.current_period_end * 1000 : null,
    });
    return `synced ${user.email} -> ${plan}`;
  };

  switch (event.type) {
    case 'checkout.session.completed': {
      const sess = event.data.object;
      if (sess.subscription) { const sub = await s.subscriptions.retrieve(sess.subscription); return syncFromSubscription(sub); }
      return 'checkout done';
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return syncFromSubscription(event.data.object);
    default:
      return `ignored ${event.type}`;
  }
}

async function findUserByCustomer(store, customerId) {
  return store.users.byStripeCustomer(customerId);
}
