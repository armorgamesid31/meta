import { ChannelType } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { runAgentTurn } from '../../agent/llm.js';
import type { AgentMessage } from '../../agent/types.js';
import { buildSalesSystemPrompt } from './systemPrompt.js';
import { buildSalesTools } from './tools.js';
import { sendCentralText } from '../whatsappCentralSender.js';
import { sendCentralIgText } from './igCentralSender.js';

const MAX_MESSAGES = 20;

export interface SalesMessageInput {
  channel: ChannelType;
  subject: string; // canonical phone (WA) | IGSID (IG)
  text: string;
}

type StoredMessage = { role: 'user' | 'assistant'; content: string };

export async function processSalesMessage(input: SalesMessageInput): Promise<void> {
  const { channel, subject, text } = input;
  if (!text.trim()) return;

  // ── Konuşmayı yükle veya oluştur ──────────────────────────────────────────
  const conv = await prisma.salesConversation.findUnique({
    where: { channel_subject: { channel, subject } },
  });

  if (conv?.status === 'closed') return;

  const history: StoredMessage[] = Array.isArray(conv?.messages)
    ? (conv!.messages as unknown as StoredMessage[])
    : [];

  history.push({ role: 'user', content: text });

  // ── Agent çalıştır ─────────────────────────────────────────────────────────
  const tools = buildSalesTools();
  const agentMessages: AgentMessage[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let replyText = '';
  let toolCalls: { name: string; args: unknown }[] = [];

  try {
    const result = await runAgentTurn({
      system: buildSalesSystemPrompt(),
      messages: agentMessages,
      tools,
      modelName: process.env.AGENT_SALES_MODEL || 'gemini-3.0-flash',
    });
    replyText = result.text.trim();
    toolCalls = result.toolCalls;
  } catch (err: any) {
    console.error('[salesAgent] runAgentTurn hatası', { channel, subject, err: err?.message });
    replyText = 'Şu an yanıt veremiyorum, lütfen kısa süre içinde tekrar yazın.';
  }

  if (!replyText) return;

  // ── Handover tespiti ───────────────────────────────────────────────────────
  const handoverCall = toolCalls.find((c) => c.name === 'request_handover');
  const handoverReason = handoverCall
    ? String((handoverCall.args as Record<string, unknown>)?.sebep ?? 'handover_requested')
    : null;

  // ── Geçmişi kaydet ─────────────────────────────────────────────────────────
  history.push({ role: 'assistant', content: replyText });
  const trimmed = history.slice(-MAX_MESSAGES);

  const newStatus = handoverReason ? 'handover' : (conv?.status ?? 'active');
  const now = new Date();

  if (conv) {
    await prisma.salesConversation.update({
      where: { id: conv.id },
      data: {
        messages: trimmed,
        status: newStatus,
        ...(handoverReason ? { handoverReason, handoverAt: now } : {}),
      },
    });
  } else {
    await prisma.salesConversation.create({
      data: {
        channel,
        subject,
        status: newStatus,
        messages: trimmed,
        ...(handoverReason ? { handoverReason, handoverAt: now } : {}),
      },
    });
  }

  // ── Yanıt gönder ───────────────────────────────────────────────────────────
  if (channel === 'WHATSAPP') {
    const r = await sendCentralText({ to: subject, text: replyText });
    if (!r.ok) console.error('[salesAgent] WA gönderim hatası', r.error);
  } else if (channel === 'INSTAGRAM') {
    await sendCentralIgText({ recipientId: subject, text: replyText });
  }

  if (handoverReason) {
    console.info('[salesAgent] handover istendi', { channel, subject, reason: handoverReason });
  }
}
