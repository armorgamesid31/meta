// LLM sağlayıcı soyutlaması + agent döngüsü (W1).
// Model-AGNOSTİK: tek satır model-swap → W7 bench (Gemini Flash vs GPT-4o-mini
// vs Haiku) ucuz. Native function-calling (metin değil yapısal tool_use) →
// halüsinasyonun MİMARİ fix'i. Default = ucuz Gemini 2.5 Flash (en yüksek
// maliyet kalemi → ucuz şart).

import { generateText, stepCountIs, type ToolSet } from 'ai';
import { google } from '@ai-sdk/google';
import type { AgentMessage, AgentTurnResult } from './types.js';

const DEFAULT_MODEL = (process.env.AGENT_MODEL || 'gemini-2.5-flash').trim();
const DEFAULT_MAX_STEPS = Number(process.env.AGENT_MAX_STEPS || 6);
// Gemini 2.5 Flash "thinking" modu büyük prompt + tool yükünde bazen BOŞ completion
// (finish=stop, 0 token) üretiyordu → cevapsız müşteri. thinkingBudget=0 bunu
// kapatır (deterministik + ucuz: reasoning token yok). 0 = kapalı (varsayılan),
// -1 = dinamik (modele bırak), >0 = sabit bütçe.
const THINKING_BUDGET = Number(process.env.AGENT_THINKING_BUDGET ?? 0);
// Boş cevap güvenlik ağı: tur boş metin + hiç tool çağrısı dönerse yeniden dene.
const EMPTY_RETRIES = Number(process.env.AGENT_EMPTY_RETRIES ?? 2);

/** Gemini thinking ayarı için providerOptions (yalnız gemini modellerinde). */
function providerOptionsFor(modelName?: string): any {
  const n = (modelName || DEFAULT_MODEL).trim();
  if (!n.startsWith('gemini')) return undefined;
  return { google: { thinkingConfig: { thinkingBudget: THINKING_BUDGET, includeThoughts: false } } };
}

/**
 * İsimden AI SDK LanguageModel çöz. Bench için sağlayıcı eklemek = burada bir
 * dal + ilgili `@ai-sdk/*` paketi (openai/anthropic W7'de). Şimdilik Gemini.
 */
export function resolveModel(name: string = DEFAULT_MODEL) {
  const n = (name || DEFAULT_MODEL).trim();
  // İleride: if (n.startsWith('gpt')) return openai(n); if (n.startsWith('claude')) return anthropic(n);
  return google(n.startsWith('gemini') ? n : 'gemini-2.5-flash');
}

/** Ardışık AYNI-rol turlarını birleştir. Gemini (ve çoğu chat API) user/assistant
 *  ALTERNATİF bekler; ardışık iki user turu (ör. cevapsız kalmış eski mesaj +
 *  yeni mesaj) modeli boş/sahte-tool-kodu üretmeye itiyordu. Metinleri "\n" ile,
 *  medyayı diziyle birleştirir → her zaman alternating, hiç boş content yok. */
function coalesceMessages(messages: AgentMessage[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const m of messages) {
    const content = (m.content || '').trim();
    const media = m.media && m.media.length ? m.media : undefined;
    if (!content && !media) continue; // boş turu at
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) {
      prev.content = [prev.content, content].filter(Boolean).join('\n');
      if (media) prev.media = [...(prev.media || []), ...media];
    } else {
      out.push({ role: m.role, content, ...(media ? { media } : {}) });
    }
  }
  return out;
}

/** AgentMessage → AI SDK ModelMessage. Medya varsa content'i çok-parçalı diziye
 *  çevirir (text + image/file part'ları); yoksa düz string. */
function toModelMessage(m: AgentMessage) {
  if (!m.media || m.media.length === 0) {
    return { role: m.role, content: m.content };
  }
  const parts: any[] = [];
  const text = (m.content || '').trim();
  if (text) parts.push({ type: 'text', text });
  for (const med of m.media) {
    if (med.kind === 'image') {
      parts.push({ type: 'image', image: med.data, mediaType: med.mediaType });
    } else {
      // ses → file part (Gemini ses'i native anlar/transkribe eder)
      parts.push({ type: 'file', data: med.data, mediaType: med.mediaType });
    }
  }
  // En az bir text part garanti (boş user content modeli tetiklemeyebilir).
  if (parts.every((p) => p.type !== 'text')) {
    parts.unshift({ type: 'text', text: '(müşteri görsel/sesli mesaj gönderdi)' });
  }
  return { role: m.role, content: parts };
}

/**
 * Tek agent turu: sistem-prompt + temiz hafıza + birleşik kullanıcı mesajı →
 * native tool-calling döngüsü (tool→sonuç→model, stepCountIs ile sınırlı) →
 * nihai metin. Tool'lar `tools` (ToolSet) olarak geçer; yan-etki ertelemesi
 * tool executor'ında (ctx.draft) yönetilir — bkz. agent/tools/registry.ts.
 */
export async function runAgentTurn(params: {
  system: string;
  messages: AgentMessage[];
  tools: ToolSet;
  modelName?: string;
  maxSteps?: number;
}): Promise<AgentTurnResult> {
  const messages = coalesceMessages(params.messages).map(toModelMessage) as any;
  const providerOptions = providerOptionsFor(params.modelName);

  let result: Awaited<ReturnType<typeof generateText>> | null = null;
  // Boş cevap güvenlik ağı: thinking kapalıyken nadir; yine de gelirse yeniden dene.
  for (let attempt = 0; attempt <= EMPTY_RETRIES; attempt++) {
    result = await generateText({
      model: resolveModel(params.modelName),
      system: params.system,
      messages,
      tools: params.tools,
      stopWhen: stepCountIs(params.maxSteps ?? DEFAULT_MAX_STEPS),
      ...(providerOptions ? { providerOptions } : {}),
    });
    const empty = !(result.text ?? '').trim() && (result.toolCalls ?? []).length === 0;
    if (!empty) break;
    console.warn(`[agent-llm] boş cevap (deneme ${attempt + 1}/${EMPTY_RETRIES + 1}, finish=${result.finishReason})`);
  }
  const r = result!;

  const usage: AgentTurnResult['usage'] = {
    inputTokens: (r.usage as any)?.inputTokens,
    outputTokens: (r.usage as any)?.outputTokens,
    totalTokens: (r.usage as any)?.totalTokens,
  };

  return {
    text: r.text ?? '',
    toolCalls: (r.toolCalls ?? []).map((c: any) => ({
      name: c.toolName ?? c.name,
      args: c.input ?? c.args,
    })),
    usage,
    steps: Array.isArray((r as any).steps) ? (r as any).steps.length : 1,
  };
}

/** Tool'suz düz metin üretimi (rolling summary gibi yardımcı işler için). */
export async function generatePlainText(params: {
  system: string;
  prompt: string;
  modelName?: string;
}): Promise<string> {
  const result = await generateText({
    model: resolveModel(params.modelName),
    system: params.system,
    prompt: params.prompt,
  });
  return result.text ?? '';
}
