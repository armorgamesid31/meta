// Agent orkestratörü — bir "konuşma turu"nun çekirdeği: memory + tools + LLM
// turu + yan-etki ertelemesi. W1+W2+W3'ü birleştirir.
//
// DIŞ katman (W4, sonraki artım): buffer/debounce + per-konuşma kilit + 5sn
// re-check loop. O katman runAgentDraft'ı çağırır; re-check bitince (nihai tur)
// executeIntents + gönderim + hafıza-commit yapar. Çekirdek ilke: taslak turlar
// YAN-ETKİSİZ (intents'e toplanır), gerçek yan-etki yalnız nihai turda.

import type { ChannelType } from '@prisma/client';
import { runAgentTurn } from './llm.js';
import { buildToolSet } from './tools/registry.js';
import { loadConversationMemory } from './memory.js';
import type { AgentMessage, ToolContext, ToolIntent } from './types.js';

export interface AgentDraftResult {
  reply: string;
  intents: ToolIntent[];
  toolCalls: { name: string; args: unknown }[];
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  steps: number;
}

/**
 * TASLAK tur: temiz hafıza + birleşik kullanıcı mesajı → agent (draft=true).
 * Yan-etkili tool'lar ÇALIŞMAZ, niyet olarak döner. Re-run güvenli (caller yeni
 * mesaj gelince bunu tekrar çağırır; hiçbir yan-etki ateşlenmemiştir).
 */
export async function runAgentDraft(params: {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  canonicalUserId: string | null;
  customerId: number | null;
  systemPrompt: string;
  mergedUserMessage: string;
  modelName?: string;
}): Promise<AgentDraftResult> {
  const memory = await loadConversationMemory({
    salonId: params.salonId,
    channel: params.channel,
    conversationKey: params.conversationKey,
  });
  const messages: AgentMessage[] = [...memory, { role: 'user', content: params.mergedUserMessage }];

  const ctx: ToolContext = {
    salonId: params.salonId,
    channel: params.channel,
    conversationKey: params.conversationKey,
    canonicalUserId: params.canonicalUserId,
    customerId: params.customerId,
    draft: true,
    intents: [],
  };

  const turn = await runAgentTurn({
    system: params.systemPrompt,
    messages,
    tools: buildToolSet(ctx),
    modelName: params.modelName,
  });

  return {
    reply: turn.text,
    intents: ctx.intents,
    toolCalls: turn.toolCalls,
    usage: turn.usage,
    steps: turn.steps,
  };
}

/**
 * NİHAİ tur yan-etkilerini işle: re-check bittikten sonra, draft=false ile
 * biriken niyetleri GERÇEKTEN çalıştır (token mint / buton gönder / handover).
 * Tool başına tekilleştirir (aynı turda iki kez location vb. olmasın).
 */
export async function executeIntents(params: {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  canonicalUserId: string | null;
  customerId: number | null;
  intents: ToolIntent[];
}): Promise<{ executed: string[] }> {
  const ctx: ToolContext = {
    salonId: params.salonId,
    channel: params.channel,
    conversationKey: params.conversationKey,
    canonicalUserId: params.canonicalUserId,
    customerId: params.customerId,
    draft: false,
    intents: [],
  };
  const tools = buildToolSet(ctx) as Record<string, { execute?: (a: unknown, o: unknown) => Promise<unknown> }>;

  const seen = new Set<string>();
  const executed: string[] = [];
  for (const intent of params.intents) {
    if (seen.has(intent.tool)) continue;
    seen.add(intent.tool);
    const t = tools[intent.tool];
    if (t?.execute) {
      await t.execute(intent.args ?? {}, {});
      executed.push(intent.tool);
    }
  }
  return { executed };
}
