import { ChannelType } from '@prisma/client';
import { prisma } from '../prisma.js';

/**
 * The Meta customer-service / standard-messaging window. Both WhatsApp and
 * Instagram allow free-form (session) messages only within 24h of the
 * customer's last inbound; outside it Meta rejects free-form sends (WhatsApp
 * 131047 "re-engagement", Instagram subcode 2534022 "outside allowed window").
 */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Is the customer-service window CLOSED for this conversation?
 *
 * Reads the canonical `conversationState.lastCustomerMessageAt` across the
 * given key variants (bare digits + channel-prefixed) so it matches whatever
 * shape the inbound webhook stored. FAIL-OPEN: when there is no signal we
 * return `false` (treat as not expired) — same as the existing manual
 * text-send gate, so we never block a send purely on missing/unloaded data.
 */
export async function isReplyWindowExpired(
  salonId: number,
  channel: ChannelType,
  conversationKeys: Array<string | null | undefined>,
): Promise<boolean> {
  const keys = Array.from(
    new Set(
      conversationKeys.filter((k): k is string => typeof k === 'string' && k.trim().length > 0),
    ),
  );
  if (!keys.length) return false;
  const rows = await prisma.conversationState.findMany({
    where: { salonId, channel, conversationKey: { in: keys } },
    select: { lastCustomerMessageAt: true },
  });
  const latest = rows
    .map((r) => r.lastCustomerMessageAt)
    .filter((v): v is Date => v instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return Boolean(latest && Date.now() - latest.getTime() > REPLY_WINDOW_MS);
}
