import Stripe from 'stripe';
import { prisma } from '../prisma.js';
import { createOwnerPendingProvisioning } from './inviteService.js';
import { getPlanByKey } from './billingCatalog.js';

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

export async function createSubscriptionCheckoutSession(input: {
  planKey: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  salonNameDraft?: string;
  locale?: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const plan = getPlanByKey(input.planKey);
  if (!plan) {
    throw new Error('PLAN_NOT_FOUND');
  }
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
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
    },
  });
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

    if (!ownerEmail || !ownerPhone || !ownerName || !planKey) {
      throw new Error('CHECKOUT_METADATA_MISSING');
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

  await prisma.stripeWebhookEvent.create({
    data: {
      eventId: event.id,
      eventType: event.type,
    },
  });

  return { duplicate: false, eventType: event.type };
}
