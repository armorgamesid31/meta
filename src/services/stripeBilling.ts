import Stripe from 'stripe';
import { prisma } from '../prisma.js';
import { createOwnerPendingProvisioning } from './inviteService.js';
import { getPlanByKey } from './billingCatalog.js';
import { attachReferredSalon } from './referralService.js';

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const secret = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secret) {
    throw new Error('STRIPE_SECRET_KEY_MISSING');
  }
  stripeClient = new Stripe(secret);
  return stripeClient;
}

type CheckoutAttemptStatus = 'PENDING' | 'COMPLETED' | 'ABANDONED' | 'FAILED';

async function upsertCheckoutAttempt(
  session: Stripe.Checkout.Session,
  patch: {
    status?: CheckoutAttemptStatus;
    failureReason?: string | null;
    completedAt?: Date | null;
    failedAt?: Date | null;
    abandonedAt?: Date | null;
  } = {},
) {
  const md = session.metadata || {};
  const planKey = String(md.planKey || '').trim().toLowerCase();
  const ownerName = String(md.ownerName || '').trim();
  const ownerEmail = String(md.ownerEmail || session.customer_details?.email || '').trim().toLowerCase();
  const ownerPhone = String(md.ownerPhone || '').trim();
  const salonNameDraft = String(md.salonNameDraft || '').trim();
  const referralCode = String(md.referralCode || '').trim().toUpperCase();
  const expiresAtUnix = Number(session.expires_at || 0);

  if (!session.id || !planKey || !ownerName || !ownerEmail || !ownerPhone) {
    return;
  }

  await prisma.stripeCheckoutAttempt.upsert({
    where: { stripeCheckoutSessionId: session.id },
    create: {
      stripeCheckoutSessionId: session.id,
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
      stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
      planKey,
      ownerName,
      ownerEmail,
      ownerPhone,
      salonNameDraft: salonNameDraft || null,
      referralCode: referralCode || null,
      status: patch.status || 'PENDING',
      paymentStatus: String(session.payment_status || '').trim() || null,
      amountTotal: typeof session.amount_total === 'number' ? session.amount_total : null,
      currency: session.currency ? String(session.currency).toUpperCase() : null,
      expiresAt: expiresAtUnix > 0 ? new Date(expiresAtUnix * 1000) : null,
      completedAt: patch.completedAt || null,
      failedAt: patch.failedAt || null,
      abandonedAt: patch.abandonedAt || null,
      failureReason: patch.failureReason || null,
    },
    update: {
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
      stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
      paymentStatus: String(session.payment_status || '').trim() || null,
      amountTotal: typeof session.amount_total === 'number' ? session.amount_total : null,
      currency: session.currency ? String(session.currency).toUpperCase() : null,
      status: patch.status,
      completedAt: patch.completedAt,
      failedAt: patch.failedAt,
      abandonedAt: patch.abandonedAt,
      failureReason: patch.failureReason === undefined ? undefined : patch.failureReason,
    },
  });
}

export async function createSubscriptionCheckoutSession(input: {
  planKey: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  salonNameDraft?: string;
  referralCode?: string;
  locale?: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const plan = getPlanByKey(input.planKey);
  if (!plan) {
    throw new Error('PLAN_NOT_FOUND');
  }
  const stripe = getStripe();
  const proIntroCouponId = String(process.env.STRIPE_COUPON_PROFESSIONAL_PLUS_INTRO || '').trim();
  const discounts =
    plan.planKey === 'profesyonel_plus' && proIntroCouponId
      ? [{ coupon: proIntroCouponId }]
      : undefined;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    ...(discounts ? { discounts } : {}),
    ...(discounts ? {} : { allow_promotion_codes: true }),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.ownerEmail,
    locale: (input.locale || 'tr') as any,
    metadata: {
      planKey: plan.planKey,
      ownerName: input.ownerName,
      ownerEmail: input.ownerEmail,
      ownerPhone: input.ownerPhone,
      salonNameDraft: input.salonNameDraft || '',
      referralCode: String(input.referralCode || '').trim().toUpperCase(),
    },
  });
  await upsertCheckoutAttempt(session, { status: 'PENDING' });
  return { checkoutUrl: session.url || '', sessionId: session.id };
}

export async function createPortalSession(input: { stripeCustomerId: string; returnUrl: string }) {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: input.stripeCustomerId,
    return_url: input.returnUrl,
  });
  return session.url;
}

export async function processStripeWebhook(rawBody: Buffer, signature: string) {
  const stripe = getStripe();
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET_MISSING');
  }
  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

  const exists = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: event.id } });
  if (exists) {
    return { duplicate: true, eventType: event.type };
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const md = session.metadata || {};
    const ownerEmail = String(md.ownerEmail || session.customer_details?.email || '').trim().toLowerCase();
    const ownerPhone = String(md.ownerPhone || '').trim();
    const ownerName = String(md.ownerName || '').trim();
    const planKey = String(md.planKey || '').trim().toLowerCase();
    const salonNameDraft = String(md.salonNameDraft || '').trim();
    const referralCode = String(md.referralCode || '').trim().toUpperCase();

    if (!ownerEmail || !ownerPhone || !ownerName || !planKey) {
      throw new Error('CHECKOUT_METADATA_MISSING');
    }

    await upsertCheckoutAttempt(session, {
      status: 'COMPLETED',
      completedAt: new Date(),
      failedAt: null,
      abandonedAt: null,
      failureReason: null,
    });

    const stripeSubscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
    if (stripeSubscriptionId) {
      const existingSubscription = await prisma.salonSubscription.findFirst({
        where: { stripeSubscriptionId },
        select: { id: true },
      });
      if (existingSubscription) {
        await prisma.stripeWebhookEvent.create({
          data: {
            eventId: event.id,
            eventType: event.type,
          },
        });
        return { duplicate: false, eventType: event.type };
      }
    }

    const provisioned = await createOwnerPendingProvisioning({
      salonName: salonNameDraft || `${ownerName} Salonu`,
      ownerName,
      ownerEmail,
      ownerPhone,
    });

    await prisma.salonSubscription.create({
      data: {
        salonId: provisioned.salonId,
        stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
        stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
        stripePriceId: getPlanByKey(planKey)?.stripePriceId || null,
        planKey,
        status: 'pending_activation',
      },
    });

    if (referralCode) {
      await attachReferredSalon({
        referralCode,
        referredSalonId: provisioned.salonId,
      });
    }
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session;
    await upsertCheckoutAttempt(session, {
      status: 'ABANDONED',
      abandonedAt: new Date(),
      failureReason: 'checkout_session_expired',
    });
  }

  if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object as Stripe.Checkout.Session;
    await upsertCheckoutAttempt(session, {
      status: 'FAILED',
      failedAt: new Date(),
      failureReason: 'checkout_session_async_payment_failed',
    });
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;
    const nextStatus = String(subscription.status || '').toLowerCase();
    const currentPeriodEndUnix = Number((subscription as any).current_period_end || 0);
    await prisma.salonSubscription.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status: nextStatus || 'unknown',
        cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
        currentPeriodEnd: currentPeriodEndUnix > 0
          ? new Date(currentPeriodEndUnix * 1000)
          : null,
      },
    });
  }

  if (event.type === 'invoice.payment_failed' || event.type === 'invoice.payment_action_required') {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionValue = (invoice as any)?.subscription;
    const stripeSubscriptionId =
      typeof subscriptionValue === 'string' ? subscriptionValue : null;
    if (stripeSubscriptionId) {
      await prisma.stripeCheckoutAttempt.updateMany({
        where: { stripeSubscriptionId },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          failureReason: event.type,
        },
      });
    }
  }

  await prisma.stripeWebhookEvent.create({
    data: {
      eventId: event.id,
      eventType: event.type,
    },
  });

  return { duplicate: false, eventType: event.type };
}
