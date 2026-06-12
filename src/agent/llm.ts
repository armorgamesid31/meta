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

/**
 * İsimden AI SDK LanguageModel çöz. Bench için sağlayıcı eklemek = burada bir
 * dal + ilgili `@ai-sdk/*` paketi (openai/anthropic W7'de). Şimdilik Gemini.
 */
export function resolveModel(name: string = DEFAULT_MODEL) {
  const n = (name || DEFAULT_MODEL).trim();
  // İleride: if (n.startsWith('gpt')) return openai(n); if (n.startsWith('claude')) return anthropic(n);
  return google(n.startsWith('gemini') ? n : 'gemini-2.5-flash');
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
  const result = await generateText({
    model: resolveModel(params.modelName),
    system: params.system,
    messages: params.messages.map(toModelMessage) as any,
    tools: params.tools,
    stopWhen: stepCountIs(params.maxSteps ?? DEFAULT_MAX_STEPS),
  });

  const usage: AgentTurnResult['usage'] = {
    inputTokens: (result.usage as any)?.inputTokens,
    outputTokens: (result.usage as any)?.outputTokens,
    totalTokens: (result.usage as any)?.totalTokens,
  };

  return {
    text: result.text ?? '',
    toolCalls: (result.toolCalls ?? []).map((c: any) => ({
      name: c.toolName ?? c.name,
      args: c.input ?? c.args,
    })),
    usage,
    steps: Array.isArray((result as any).steps) ? (result as any).steps.length : 1,
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
