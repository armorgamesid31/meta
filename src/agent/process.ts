// Agent giriş noktası (W4 ilk-kesit, SHADOW-capable). Bir konuşma + birleşik
// kullanıcı mesajı → backend agent'ın TASLAK cevabı + tool çağrıları. Gönderim/
// commit YOK (shadow: n8n gerçek cevabı verirken backend ne CEVAP VERİRDİ'yi
// üretir → karşılaştırma). Tam W4 (per-konuşma kilit + 5sn debounce + re-check
// loop + nihai gönderim/commit) bunun üstüne gelir.

import type { ChannelType } from '@prisma/client';
import { runAgentDraft, type AgentDraftResult } from './orchestrator.js';
import { buildAgentSystemPrompt } from './systemPrompt.js';

export interface ProcessDraftResult extends AgentDraftResult {
  systemPrompt: string;
}

export async function processConversationDraft(input: {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  canonicalUserId: string | null;
  customerId: number | null;
  channelProfileName: string | null;
  registeredName: string | null;
  mergedUserMessage: string;
  modelName?: string;
  repliedTo?: Parameters<typeof buildAgentSystemPrompt>[0]['repliedTo'];
}): Promise<ProcessDraftResult> {
  const systemPrompt = await buildAgentSystemPrompt({
    salonId: input.salonId,
    customerId: input.customerId,
    channelProfileName: input.channelProfileName,
    registeredName: input.registeredName,
    repliedTo: input.repliedTo,
  });

  const draft = await runAgentDraft({
    salonId: input.salonId,
    channel: input.channel,
    conversationKey: input.conversationKey,
    canonicalUserId: input.canonicalUserId,
    customerId: input.customerId,
    systemPrompt,
    mergedUserMessage: input.mergedUserMessage,
    modelName: input.modelName,
  });

  return { systemPrompt, ...draft };
}
