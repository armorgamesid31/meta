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
    messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
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
