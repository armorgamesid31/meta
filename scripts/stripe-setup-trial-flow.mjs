#!/usr/bin/env node
/**
 * Stripe provisioning for the Setup Center / trial-bonus flow.
 *
 * Idempotent: re-running won't create duplicates. Uses idempotency
 * keys + lookup_key for prices.
 *
 * Run AFTER you've rotated your live key and put the new one in
 * meta/.env as STRIPE_SECRET_KEY. Test mode strongly recommended for
 * the first run:
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup-trial-flow.mjs
 *
 * What it creates / verifies:
 *   1. Product "Kedy Profesyonel+"  (key: kedy_profesyonel_plus)
 *   2. Product "Kedy Temel"          (key: kedy_temel)
 *   3. Recurring price for Profesyonel+ at 2.999 TRY/month
 *      lookup_key: kedy_profesyonel_plus_monthly_v1
 *   4. Recurring price for Temel at 499 TRY/month
 *      lookup_key: kedy_temel_monthly_v1
 *   5. A webhook endpoint targeting ${STRIPE_WEBHOOK_TARGET_URL} for the
 *      events we listen to in src/services/stripeBilling.ts:
 *        - checkout.session.completed
 *        - checkout.session.expired
 *        - checkout.session.async_payment_failed
 *        - customer.subscription.created
 *        - customer.subscription.updated
 *        - customer.subscription.deleted
 *        - invoice.payment_failed
 *        - invoice.payment_action_required
 *
 * After running, paste the printed env vars into meta/.env:
 *
 *   STRIPE_PRICE_TEMEL=price_xxx
 *   STRIPE_PRICE_PROFESSIONAL_PLUS=price_yyy
 *   STRIPE_WEBHOOK_SECRET=whsec_zzz
 *
 * The "ilk 3 ay 999 TL" coupon from the old marketing flow stays
 * untouched — this script doesn't manage promo coupons. If you want
 * to deprecate it later, unset STRIPE_COUPON_PROFESSIONAL_PLUS_INTRO
 * in .env.
 */

import Stripe from 'stripe';
import process from 'node:process';

const secret = (process.env.STRIPE_SECRET_KEY || '').trim();
if (!secret) {
  console.error('STRIPE_SECRET_KEY missing. Put it in meta/.env and retry.');
  process.exit(1);
}
if (secret.startsWith('sk_live_')) {
  console.warn(
    '\n  WARNING: You are running against LIVE Stripe.\n' +
    '  Press Ctrl+C in the next 5 seconds if this is wrong.\n',
  );
  await new Promise((r) => setTimeout(r, 5000));
}

const stripe = new Stripe(secret);

const WEBHOOK_TARGET =
  (process.env.STRIPE_WEBHOOK_TARGET_URL || '').trim() ||
  'https://api.kedyapp.com/api/billing/stripe/webhook';

const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.payment_action_required',
];

const PRODUCTS = [
  {
    productKey: 'kedy_temel',
    name: 'Kedy Temel',
    description: 'Salon yönetimi, online booking, WhatsApp Business bağlama, temel raporlar.',
    priceLookupKey: 'kedy_temel_monthly_v1',
    priceAmountKurus: 49900,  // 499.00 TRY
    priceCurrency: 'try',
  },
  {
    productKey: 'kedy_profesyonel_plus',
    name: 'Kedy Profesyonel+',
    description:
      'Tüm Temel özellikler + WhatsApp/Instagram AI asistanı, no-show otomasyonu, ' +
      'gelişmiş raporlar, doğum günü kampanyaları ve daha fazlası.',
    priceLookupKey: 'kedy_profesyonel_plus_monthly_v1',
    priceAmountKurus: 299900, // 2.999.00 TRY
    priceCurrency: 'try',
  },
];

async function findOrCreateProduct(spec) {
  // Look up by metadata.productKey first.
  const existing = await stripe.products.search({
    query: `metadata['productKey']:'${spec.productKey}' AND active:'true'`,
    limit: 1,
  });
  if (existing.data.length > 0) {
    console.log(`✓ product ${spec.productKey} already exists: ${existing.data[0].id}`);
    return existing.data[0];
  }
  const product = await stripe.products.create({
    name: spec.name,
    description: spec.description,
    metadata: { productKey: spec.productKey, managedBy: 'kedy_setup_script' },
  });
  console.log(`+ created product ${spec.productKey}: ${product.id}`);
  return product;
}

async function findOrCreatePrice(spec, productId) {
  const existing = await stripe.prices.list({
    lookup_keys: [spec.priceLookupKey],
    active: true,
    limit: 1,
  });
  if (existing.data.length > 0) {
    console.log(`✓ price ${spec.priceLookupKey} already exists: ${existing.data[0].id}`);
    return existing.data[0];
  }
  const price = await stripe.prices.create({
    product: productId,
    unit_amount: spec.priceAmountKurus,
    currency: spec.priceCurrency,
    recurring: { interval: 'month' },
    lookup_key: spec.priceLookupKey,
    metadata: { productKey: spec.productKey, managedBy: 'kedy_setup_script' },
  });
  console.log(`+ created price ${spec.priceLookupKey}: ${price.id}`);
  return price;
}

async function findOrCreateWebhook() {
  const all = await stripe.webhookEndpoints.list({ limit: 100 });
  const found = all.data.find((w) => w.url === WEBHOOK_TARGET);
  if (found) {
    // Patch event set if it drifted.
    const desired = [...WEBHOOK_EVENTS].sort();
    const current = [...(found.enabled_events || [])].sort();
    if (JSON.stringify(desired) !== JSON.stringify(current)) {
      await stripe.webhookEndpoints.update(found.id, { enabled_events: WEBHOOK_EVENTS });
      console.log(`~ updated webhook ${found.id} events`);
    } else {
      console.log(`✓ webhook ${found.url} already configured: ${found.id}`);
    }
    // Stripe won't reveal the existing secret; we can only reveal it
    // at creation time. If you need to read it again later, rotate
    // via Stripe Dashboard -> Developers -> Webhooks -> "Reveal".
    return { endpoint: found, secret: null };
  }
  const created = await stripe.webhookEndpoints.create({
    url: WEBHOOK_TARGET,
    enabled_events: WEBHOOK_EVENTS,
    description: 'Kedy backend — Setup Center + legacy marketing checkout.',
  });
  console.log(`+ created webhook ${created.url}: ${created.id}`);
  return { endpoint: created, secret: created.secret || null };
}

(async () => {
  const envOut = {};

  for (const spec of PRODUCTS) {
    const product = await findOrCreateProduct(spec);
    const price = await findOrCreatePrice(spec, product.id);
    if (spec.productKey === 'kedy_temel') {
      envOut.STRIPE_PRICE_TEMEL = price.id;
    } else if (spec.productKey === 'kedy_profesyonel_plus') {
      envOut.STRIPE_PRICE_PROFESSIONAL_PLUS = price.id;
    }
  }

  const { secret: whsec } = await findOrCreateWebhook();
  if (whsec) envOut.STRIPE_WEBHOOK_SECRET = whsec;

  console.log('\n--- env vars (paste into meta/.env) ---');
  for (const [key, value] of Object.entries(envOut)) {
    console.log(`${key}=${value}`);
  }
  if (!whsec) {
    console.log(
      '\nNote: webhook endpoint already existed — Stripe does not let scripts read the' +
      '\nexisting signing secret. If you do not already have STRIPE_WEBHOOK_SECRET set,' +
      '\nrotate the secret from Stripe Dashboard -> Developers -> Webhooks -> click the' +
      '\nendpoint -> Reveal/Roll signing secret, then paste here.',
    );
  }
  console.log('--- done. ---');
})().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
