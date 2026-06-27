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

// ── Multi-model test konfigürasyonu ───────────────────────────────────────────
const TEST_MODELS = [
  { key: 'deepseek', label: '🔵 DeepSeek V3', modelId: 'deepseek/deepseek-chat' },
  { key: 'haiku',    label: '🟠 Claude Haiku', modelId: 'anthropic/claude-haiku-4-5' },
  { key: '4omini',   label: '🟢 GPT-4o Mini',  modelId: 'openai/gpt-4o-mini' },
  { key: 'gemini3',  label: '💜 Gemini 3 Flash', modelId: 'google/gemini-3-flash-preview' },
] as const;

function isTestSubject(subject: string): boolean {
  const strip = (s: string) => s.replace(/^\+/, '');
  const list = (process.env.SALES_TEST_SUBJECTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.some((s) => strip(s) === strip(subject));
}

// subject + model için bileşik anahtar (şema değişikliği yok)
function modelSubject(subject: string, modelKey: string) {
  return `${subject}__${modelKey}`;
}

async function runSingleModel(
  channel: ChannelType,
  subject: string,
  text: string,
  modelId: string,
  label: string,
  storageSubject: string,
): Promise<void> {
  const conv = await prisma.salesConversation.findUnique({
    where: { channel_subject: { channel, subject: storageSubject } },
  });

  if (conv?.status === 'closed') return;

  const history: StoredMessage[] = Array.isArray(conv?.messages)
    ? (conv!.messages as unknown as StoredMessage[])
    : [];

  history.push({ role: 'user', content: text });

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
      modelName: modelId,
      openrouterKey: process.env.OPENROUTER_SALES_API_KEY,
    });
    replyText = result.text.trim();
    toolCalls = result.toolCalls;
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error('[salesAgent/test] runAgentTurn hatası', { modelId, errMsg });
    replyText = `[HATA] ${errMsg.slice(0, 200)}`;
  }

  if (!replyText) return;

  const handoverCall = toolCalls.find((c) => c.name === 'request_handover');
  const handoverReason = handoverCall
    ? String((handoverCall.args as Record<string, unknown>)?.sebep ?? 'handover_requested')
    : null;

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
        subject: storageSubject,
        status: newStatus,
        messages: trimmed,
        ...(handoverReason ? { handoverReason, handoverAt: now } : {}),
      },
    });
  }

  // Cevabın başına model etiketi ekle
  const taggedReply = `${label}\n${replyText}`;

  if (channel === 'WHATSAPP') {
    const r = await sendCentralText({ to: subject, text: taggedReply });
    if (!r.ok) console.error('[salesAgent/test] WA gönderim hatası', { label, error: r.error });
  } else if (channel === 'INSTAGRAM') {
    await sendCentralIgText({ recipientId: subject, text: taggedReply });
  }
}

async function processMultiModelSalesMessage(input: SalesMessageInput): Promise<void> {
  const { channel, subject, text } = input;

  // memorysil: tüm model varyantlarını temizle
  if (text.trim().toLowerCase() === 'memorysil') {
    await Promise.all(
      TEST_MODELS.map((m) =>
        prisma.salesConversation.upsert({
          where: { channel_subject: { channel, subject: modelSubject(subject, m.key) } },
          update: { messages: [], status: 'active', handoverReason: null, handoverAt: null },
          create: { channel, subject: modelSubject(subject, m.key), messages: [], status: 'active' },
        }),
      ),
    );
    const msg = 'Tüm modellerin hafızası temizlendi 🧹 (DeepSeek / Haiku / 4o-mini / Gemini 3)';
    if (channel === 'WHATSAPP') await sendCentralText({ to: subject, text: msg });
    else await sendCentralIgText({ recipientId: subject, text: msg });
    return;
  }

  // 4 modeli paralel çalıştır
  await Promise.all(
    TEST_MODELS.map((m) =>
      runSingleModel(channel, subject, text, m.modelId, m.label, modelSubject(subject, m.key)),
    ),
  );
}

export async function processSalesMessage(input: SalesMessageInput): Promise<void> {
  const { channel, subject, text } = input;
  if (!text.trim()) return;

  // Test modunda tüm modelleri paralel çalıştır
  if (isTestSubject(subject)) {
    await processMultiModelSalesMessage(input);
    return;
  }

  // ── memorysil komutu ──────────────────────────────────────────────────────
  if (text.trim().toLowerCase() === 'memorysil') {
    await prisma.salesConversation.upsert({
      where: { channel_subject: { channel, subject } },
      update: { messages: [], status: 'active', handoverReason: null, handoverAt: null },
      create: { channel, subject, messages: [], status: 'active' },
    });
    if (channel === 'WHATSAPP') await sendCentralText({ to: subject, text: 'Hafıza temizlendi 🧹' });
    else await sendCentralIgText({ recipientId: subject, text: 'Hafıza temizlendi 🧹' });
    return;
  }

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
      modelName: process.env.AGENT_SALES_MODEL || 'google/gemini-2.5-flash',
      openrouterKey: process.env.OPENROUTER_SALES_API_KEY,
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
