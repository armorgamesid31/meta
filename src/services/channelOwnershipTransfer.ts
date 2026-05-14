// Channel ownership transfer — guarantees that any WhatsApp phone_number_id
// or Instagram business account id is owned by exactly one salon at a time.
//
// Meta enforces this at the upstream side: a WABA phone number can only be
// bound to a single Chakra plugin, and an IG account's webhook events flow
// to a single subscribing app. When a second salon connects the same
// identifier, ours used to either silently take over the binding while
// leaving stale salon-level fields on the previous salon, or refuse the
// new connection entirely. Both behaviors created ghost connections that
// confused operators (the previous salon's UI kept saying "connected" but
// inbound traffic went somewhere else).
//
// New rule: latest connection wins. The previous salon's bindings + plugin
// state + AI agent settings get wiped at claim time so the operator sees
// the correct connected/disconnected indicator across the board.

import { ChannelType, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';

interface OwnershipTransferContext {
  // Optional cleanup hook — e.g. cancel pending template submissions for
  // the displaced salon, since they no longer own the WABA they were
  // submitting to. Keeps the worker queue from grinding on a dead binding.
  onDisplaced?: (displacedSalonId: number) => Promise<void>;
}

function normalize(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Wipe a salon's WhatsApp connection state. Called when another salon
 * claims its phone_number_id, OR when an operator explicitly disconnects.
 */
async function wipeWhatsAppForSalon(salonId: number): Promise<void> {
  // Clear salon-level pointers — these drive the templates submitter, the
  // composer's recipient resolution, and the "WhatsApp connected" badge.
  await prisma.salon.update({
    where: { id: salonId },
    data: {
      chakraPluginId: null,
      chakraPhoneNumberId: null,
    },
  });

  // Deactivate all WhatsApp bindings for this salon. Note: the unique key
  // is (channel, externalAccountId), so we may have multiple rows here
  // historically — flip them all off.
  await prisma.salonChannelBinding.updateMany({
    where: { salonId, channel: 'WHATSAPP' },
    data: { isActive: false },
  });

  // Patch the AI agent settings JSON so the UI/agent picks up the new
  // disconnected state. Merge with existing answers — don't blow them away.
  const existing = await prisma.salonAiAgentSettings.findUnique({
    where: { salonId },
    select: { id: true, faqAnswers: true },
  });
  if (existing) {
    const current = (existing.faqAnswers as Record<string, any>) || {};
    const next = {
      ...current,
      whatsappPluginActive: false,
      whatsappPhoneNumberId: null,
      whatsappConnectedAt: null,
    };
    await prisma.salonAiAgentSettings.update({
      where: { salonId },
      data: { faqAnswers: next as Prisma.InputJsonValue },
    });
  }
}

/**
 * Wipe a salon's Instagram connection state. Called when another salon
 * claims its IG account, OR on explicit disconnect.
 */
async function wipeInstagramForSalon(salonId: number): Promise<void> {
  await prisma.salonChannelBinding.updateMany({
    where: { salonId, channel: 'INSTAGRAM' },
    data: { isActive: false },
  });

  const existing = await prisma.salonAiAgentSettings.findUnique({
    where: { salonId },
    select: { id: true, faqAnswers: true },
  });
  if (existing) {
    const current = (existing.faqAnswers as Record<string, any>) || {};
    const metaDirect = { ...(current.metaDirect || {}) };
    // Preserve other metaDirect keys (e.g. whatsapp config) — only clear IG.
    delete metaDirect.instagram;
    const next = { ...current, metaDirect };
    await prisma.salonAiAgentSettings.update({
      where: { salonId },
      data: { faqAnswers: next as Prisma.InputJsonValue },
    });
  }
}

/**
 * Claim a WhatsApp phone_number_id for `newSalonId`. If another salon
 * already owns it, that salon's connection state is wiped first. Idempotent
 * when called repeatedly with the same (salon, phone) pair.
 *
 * Returns the displaced salon's id (if any) so callers can log / notify.
 */
export async function claimWhatsAppOwnership(
  newSalonId: number,
  phoneNumberId: string | null,
  ctx?: OwnershipTransferContext,
): Promise<{ displacedSalonId: number | null }> {
  const id = normalize(phoneNumberId);
  if (!id) return { displacedSalonId: null };

  // Find ANY active binding for this identifier in another salon, plus any
  // salon-level chakraPhoneNumberId pointing at the same id. Both surfaces
  // are scanned because legacy rows could lag the binding table.
  const existingBindingOwner = await prisma.salonChannelBinding.findUnique({
    where: {
      channel_externalAccountId: {
        channel: 'WHATSAPP',
        externalAccountId: id,
      },
    },
    select: { salonId: true, isActive: true },
  });

  const stalePointers = await prisma.salon.findMany({
    where: {
      chakraPhoneNumberId: id,
      NOT: { id: newSalonId },
    },
    select: { id: true },
  });

  const displacedIds = new Set<number>();
  if (
    existingBindingOwner &&
    existingBindingOwner.salonId !== newSalonId
  ) {
    displacedIds.add(existingBindingOwner.salonId);
  }
  for (const s of stalePointers) displacedIds.add(s.id);

  for (const displacedSalonId of displacedIds) {
    await wipeWhatsAppForSalon(displacedSalonId);
    if (ctx?.onDisplaced) {
      try {
        await ctx.onDisplaced(displacedSalonId);
      } catch (err) {
        console.error('[channelOwnershipTransfer] onDisplaced hook failed:', err);
      }
    }
    console.warn('[channelOwnershipTransfer] WhatsApp ownership transferred', {
      phoneNumberId: id,
      from: displacedSalonId,
      to: newSalonId,
    });
  }

  // Upsert binding under new salon (active).
  await prisma.salonChannelBinding.upsert({
    where: {
      channel_externalAccountId: {
        channel: 'WHATSAPP',
        externalAccountId: id,
      },
    },
    update: { salonId: newSalonId, isActive: true },
    create: {
      salonId: newSalonId,
      channel: 'WHATSAPP',
      externalAccountId: id,
      isActive: true,
    },
  });

  // Caller (chakra connect/sync flow) is responsible for setting
  // chakraPluginId + chakraPhoneNumberId on the new salon's row. We don't
  // own that part of the schema here — keeping concerns separated.

  return {
    displacedSalonId: displacedIds.size > 0 ? Array.from(displacedIds)[0] : null,
  };
}

/**
 * Claim an Instagram business account id for `newSalonId`. Same semantics
 * as WhatsApp — wipes the previous salon's IG state if present.
 */
export async function claimInstagramOwnership(
  newSalonId: number,
  instagramAccountId: string | null,
  ctx?: OwnershipTransferContext,
): Promise<{ displacedSalonId: number | null }> {
  const id = normalize(instagramAccountId);
  if (!id) return { displacedSalonId: null };

  const existingBindingOwner = await prisma.salonChannelBinding.findUnique({
    where: {
      channel_externalAccountId: {
        channel: 'INSTAGRAM',
        externalAccountId: id,
      },
    },
    select: { salonId: true, isActive: true },
  });

  // For IG we also need to scan the AI agent settings JSON because the
  // metaDirect.instagram.externalAccountId pointer can lag the binding
  // table (older code wrote one without the other).
  const settingsRows = await prisma.salonAiAgentSettings.findMany({
    select: { salonId: true, faqAnswers: true },
  });
  const staleSettingsOwners = settingsRows
    .filter(r => {
      const ig = (r.faqAnswers as any)?.metaDirect?.instagram;
      const owned = typeof ig?.externalAccountId === 'string'
        && ig.externalAccountId.trim() === id;
      return owned && r.salonId !== newSalonId;
    })
    .map(r => r.salonId);

  const displacedIds = new Set<number>();
  if (
    existingBindingOwner &&
    existingBindingOwner.salonId !== newSalonId
  ) {
    displacedIds.add(existingBindingOwner.salonId);
  }
  for (const sid of staleSettingsOwners) displacedIds.add(sid);

  for (const displacedSalonId of displacedIds) {
    await wipeInstagramForSalon(displacedSalonId);
    if (ctx?.onDisplaced) {
      try {
        await ctx.onDisplaced(displacedSalonId);
      } catch (err) {
        console.error('[channelOwnershipTransfer] onDisplaced hook failed:', err);
      }
    }
    console.warn('[channelOwnershipTransfer] Instagram ownership transferred', {
      instagramAccountId: id,
      from: displacedSalonId,
      to: newSalonId,
    });
  }

  await prisma.salonChannelBinding.upsert({
    where: {
      channel_externalAccountId: {
        channel: 'INSTAGRAM',
        externalAccountId: id,
      },
    },
    update: { salonId: newSalonId, isActive: true },
    create: {
      salonId: newSalonId,
      channel: 'INSTAGRAM',
      externalAccountId: id,
      isActive: true,
    },
  });

  return {
    displacedSalonId: displacedIds.size > 0 ? Array.from(displacedIds)[0] : null,
  };
}

// Re-exported for symmetry — callers that want to disconnect a salon
// explicitly (e.g. admin "Disconnect WhatsApp" button) can reuse these.
export { wipeWhatsAppForSalon, wipeInstagramForSalon };

// Generic dispatcher used where the channel is dynamic.
export async function claimChannelOwnership(
  channel: ChannelType,
  newSalonId: number,
  externalAccountId: string | null,
  ctx?: OwnershipTransferContext,
): Promise<{ displacedSalonId: number | null }> {
  if (channel === 'WHATSAPP') {
    return claimWhatsAppOwnership(newSalonId, externalAccountId, ctx);
  }
  if (channel === 'INSTAGRAM') {
    return claimInstagramOwnership(newSalonId, externalAccountId, ctx);
  }
  return { displacedSalonId: null };
}
