// Agent gönderim katmanı (W4). Nihai AI metnini + (varsa) TEK butonu kanala uygun
// şekilde TEK mesajda yollar — mevcut internalAgentOutbound send fonksiyonlarını
// REUSE eder (davranış/buton-embed aynı) — VE hafızaya işler (outboundMessageTrace
// + ConversationMessageEvent OUTBOUND). Memory commit kritik: bir sonraki turun
// temiz hafızası (loadConversationMemory) bu OUTBOUND event'ten asistan sözünü okur.
//
// n8n paritesi: buton tool'la "hazırlanır", metinle birlikte tek mesajda gider;
// ikinci bir "output mesajı" YOK. Deferred ConversationState pending-marker'ı
// KULLANMAZ (buton inline hazır → yarış yok; migrasyonun amacı buydu).

import { ChannelType, OutboundMessageSource } from '@prisma/client';
import { prisma } from '../prisma.js';
import { upsertConversationMessageEvent } from '../services/conversationMessageEvents.js';
import { sendInstagramMessage, sendWhatsappViaChakra } from '../routes/internalAgentOutbound.js';
import type { AgentButton } from './types.js';

type ActionKind = 'none' | 'booking' | 'location' | 'profile_edit';

// Tek mesaj = tek buton. Birden çok hazırlandıysa eylem-önceliği: randevu en
// güçlü çağrı, sonra profil-düzenleme, sonra konum.
const BUTTON_PRIORITY: AgentButton['kind'][] = ['booking', 'profile_edit', 'location'];

function pickButton(buttons: AgentButton[]): AgentButton | null {
  for (const kind of BUTTON_PRIORITY) {
    const b = buttons.find((x) => x.kind === kind);
    if (b) return b;
  }
  return buttons[0] ?? null;
}

/** Nihai cevabı gönder + hafızaya işle. Buton varsa kanal-uygun şekilde iliştirir. */
export async function sendAgentReply(params: {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  canonicalUserId: string | null;
  customerId: number | null;
  customerName?: string | null;
  text: string;
  buttons?: AgentButton[];
  externalAccountId?: string | null;
}): Promise<{ ok: boolean; providerMessageId: string | null }> {
  const button = pickButton(params.buttons ?? []);
  const actionKind: ActionKind = (button?.kind as ActionKind) ?? 'none';

  const sendArgs = {
    salonId: params.salonId,
    conversationKey: params.conversationKey,
    text: params.text,
    actionKind,
    magicLinkUrl: button?.kind === 'booking' ? button.url : null,
    locationUrl: button?.kind === 'location' ? button.url : null,
    profileEditUrl: button?.kind === 'profile_edit' ? button.url : null,
    externalAccountId: params.externalAccountId ?? null,
  };

  const sent =
    params.channel === 'INSTAGRAM'
      ? await sendInstagramMessage(sendArgs)
      : await sendWhatsappViaChakra(sendArgs);

  const now = new Date();
  const providerMessageId = sent?.providerMessageId ?? null;
  const externalAccountId = sent?.externalAccountId || params.externalAccountId || '';

  // 1) Outbound trace (AI_AGENT) — idempotent, echo-eşleştirme için.
  if (providerMessageId) {
    await prisma.outboundMessageTrace
      .upsert({
        where: { channel_providerMessageId: { channel: params.channel, providerMessageId } },
        update: {
          salonId: params.salonId,
          conversationKey: params.conversationKey,
          externalAccountId: externalAccountId || null,
          canonicalUserId: params.canonicalUserId,
          customerId: params.customerId,
          source: OutboundMessageSource.AI_AGENT,
          text: params.text,
          sentAt: now,
        },
        create: {
          salonId: params.salonId,
          channel: params.channel,
          conversationKey: params.conversationKey,
          providerMessageId,
          externalAccountId: externalAccountId || null,
          canonicalUserId: params.canonicalUserId,
          customerId: params.customerId,
          source: OutboundMessageSource.AI_AGENT,
          text: params.text,
          sentAt: now,
        },
      })
      .catch((err) => console.error('[agent-outbound] trace upsert failed', err?.message || err));
  }

  // 2) Memory commit — ConversationMessageEvent OUTBOUND (temiz hafıza kaynağı).
  await upsertConversationMessageEvent({
    salonId: params.salonId,
    channel: params.channel,
    conversationKey: params.conversationKey,
    providerMessageId: providerMessageId || `ai_${now.getTime()}`,
    externalAccountId,
    customerName: params.customerName ?? null,
    messageType: actionKind === 'none' ? 'text_outbound_ai' : `interactive_${actionKind}_outbound_ai`,
    text: params.text,
    direction: 'OUTBOUND',
    eventTimestamp: now,
    processingStatus: 'DONE',
    outboundSource: OutboundMessageSource.AI_AGENT,
    rawPayload: {
      direction: 'outbound',
      source: 'AI_AGENT',
      engine: 'BACKEND',
      actionKind,
      buttonUrl: button?.url ?? null,
      providerResponse: sent?.rawResponse ?? null,
    } as any,
  });

  return { ok: true, providerMessageId };
}
