/**
 * One-off, IDEMPOTENT setup of the Stripe objects the 2026-06 acquisition
 * campaign needs:
 *
 *   1. STRIPE_COUPON_REFERRAL_2M  — referral reward: 100% off for 2 months.
 *   2. STRIPE_PRICE_PROFESSIONAL_PLUS_SEAT_TIERED — tiered (graduated)
 *      seat price for profesyonel_plus:
 *         tier 1: up_to 5 employees  -> flat 99900  (999 TRY / month)
 *         tier 2: each extra employee -> +15000     (+150 TRY / month)
 *
 * SAFETY:
 *   - Refuses to run unless STRIPE_SECRET_KEY starts with `sk_test_`.
 *   - Idempotent: both objects are tagged with metadata.kedy_purpose and
 *     re-used if they already exist. Running this twice is a no-op (it
 *     just re-prints the existing ids).
 *
 * USAGE:  node scripts/setup-campaign-stripe-objects.mjs
 * Then copy the printed env lines into meta/.env.
 */

import 'dotenv/config';
import Stripe from 'stripe';

const SECRET = String(process.env.STRIPE_SECRET_KEY || '').trim();
if (!SECRET) {
  console.error('STRIPE_SECRET_KEY missing in env');
  process.exit(1);
}
if (!SECRET.startsWith('sk_test_')) {
  console.error(
    `REFUSING TO RUN: STRIPE_SECRET_KEY is not a test key (starts with "${SECRET.slice(0, 8)}"). ` +
      'This script only runs against Stripe test mode.',
  );
  process.exit(1);
}

const stripe = new Stripe(SECRET);

const COUPON_PURPOSE = 'referral_2m';
const SEAT_PRICE_PURPOSE = 'seat_tiered_profesyonel_plus';

async function ensureReferralCoupon() {
  // Stripe coupons aren't searchable by metadata via the Search API, so
  // page through list() and match on metadata. The coupon list is tiny.
  for await (const coupon of stripe.coupons.list({ limit: 100 })) {
    if (
      coupon.metadata?.kedy_purpose === COUPON_PURPOSE &&
      coupon.valid !== false
    ) {
      return { id: coupon.id, reused: true };
    }
  }
  const created = await stripe.coupons.create({
    name: 'Kedy Referral — 2 ay %100',
    percent_off: 100,
    duration: 'repeating',
    duration_in_months: 2,
    metadata: { kedy_purpose: COUPON_PURPOSE },
  });
  return { id: created.id, reused: false };
}

async function ensureSeatTieredPrice() {
  const basePriceId = String(process.env.STRIPE_PRICE_PROFESSIONAL_PLUS || '').trim();
  if (!basePriceId) {
    throw new Error('STRIPE_PRICE_PROFESSIONAL_PLUS missing — cannot resolve product for tiered seat price');
  }
  const basePrice = await stripe.prices.retrieve(basePriceId);
  const productId = typeof basePrice.product === 'string' ? basePrice.product : basePrice.product.id;
  const currency = basePrice.currency; // match existing plan currency (try)

  // Look for an already-created tiered price on the same product.
  for await (const price of stripe.prices.list({ product: productId, limit: 100, active: true })) {
    if (price.metadata?.kedy_purpose === SEAT_PRICE_PURPOSE) {
      return { id: price.id, reused: true, productId, currency };
    }
  }

  const created = await stripe.prices.create({
    product: productId,
    currency,
    recurring: { interval: 'month', usage_type: 'licensed' },
    billing_scheme: 'tiered',
    tiers_mode: 'graduated',
    tiers: [
      // İlk 5 çalışana kadar sabit 999 TRY/ay (flat).
      { up_to: 5, flat_amount: 99900 },
      // 5'ten sonraki her çalışan +150 TRY/ay (unit).
      { up_to: 'inf', unit_amount: 15000 },
    ],
    metadata: { kedy_purpose: SEAT_PRICE_PURPOSE, plan: 'profesyonel_plus' },
    nickname: 'Profesyonel+ tiered seat (5 dahil 999 + 150/ek)',
  });
  return { id: created.id, reused: false, productId, currency };
}

async function main() {
  console.log('Stripe mode: TEST (sk_test_…) — safe to create objects.\n');

  const coupon = await ensureReferralCoupon();
  console.log(`Coupon  [${coupon.reused ? 'reused' : 'CREATED'}]: ${coupon.id}`);

  const price = await ensureSeatTieredPrice();
  console.log(
    `Price   [${price.reused ? 'reused' : 'CREATED'}]: ${price.id}  (product=${price.productId}, currency=${price.currency})`,
  );

  console.log('\n--- Add/verify these lines in meta/.env ---');
  console.log(`STRIPE_COUPON_REFERRAL_2M=${coupon.id}`);
  console.log(`STRIPE_PRICE_PROFESSIONAL_PLUS_SEAT_TIERED=${price.id}`);
}

main().catch((err) => {
  console.error('FAILED:', err?.message || err);
  process.exit(1);
});
