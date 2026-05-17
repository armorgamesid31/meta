/**
 * n8n sistem promptunu yerelde render eden test yardımcısı.
 * ai_agent.json'daki "AI Agent Single" node'unun systemMessage template'ini okur,
 * verilen payload ile yer tutucuları doldurur, regression testlerinde kullanır.
 *
 * Desteklenen n8n expression alt kümesi:
 *   {{ $json.body?.foo }}                       → payload.body?.foo
 *   {{ $json.body?.foo || 'fallback' }}          → payload.body?.foo ?? 'fallback'
 *   {{ $json.body?.repliedTo ? '...A...' : '' }} → ternary
 *   (Bizim sistem promptumuz dışında bir şey kullanılırsa burayı genişlet.)
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadSalonAgentContext, type SalonAgentContext } from '../../src/services/salonAgentContext.js';

const WORKFLOW_PATH = path.resolve(__dirname, '../../n8n/workflows/ai_agent.json');

let cachedTemplate: string | null = null;

/** ai_agent.json'dan AI Agent Single node'unun systemMessage'ını alır. */
export function loadSystemPromptTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  const raw = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  const workflow = JSON.parse(raw);
  const agentNode = (workflow.nodes as any[]).find((n) => n.name === 'AI Agent Single');
  if (!agentNode) throw new Error('AI Agent Single node not found in workflow');
  const sysMsg: string = agentNode.parameters?.options?.systemMessage;
  if (!sysMsg) throw new Error('systemMessage missing');
  // n8n: "=..." prefix means expression. Strip it.
  cachedTemplate = sysMsg.startsWith('=') ? sysMsg.slice(1) : sysMsg;
  return cachedTemplate;
}

export interface PromptRenderPayload {
  body: {
    toneDirective?: string;
    styleDirective?: string;
    salonOneLiner?: string;
    profileName?: string;
    repliedTo?: {
      direction: 'inbound' | 'outbound';
      fromAI?: boolean;
      text?: string;
      mediaLabel?: string;
    } | null;
  };
}

/**
 * `{{ ... }}` ifadelerini değerlendirir. Bizim systemMessage'ımız sadece şunları kullanıyor:
 *  - basit `$json.body?.foo`
 *  - `||` fallback
 *  - ternary `... ? 'A' : ''`
 *  - string concat ve method calls (.toString(), .replace())
 *
 * Bunları doğru çalıştırmanın en güvenli yolu: ifadeyi Function constructor ile JS'te
 * çalıştırmak. Side effect izole — sadece $json okur, başka şey yapmaz.
 */
function evaluateExpression(expr: string, payload: PromptRenderPayload): string {
  // n8n'de "?." Türkçe kodda yaygın — JS'te zaten var. "&&", "||" da JS native.
  // Sadece $json'u local var olarak yarat.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('$json', `try { return (${expr}); } catch (e) { return ''; }`);
  const value = fn(payload);
  return value === undefined || value === null ? '' : String(value);
}

export function renderSystemPrompt(payload: PromptRenderPayload, template?: string): string {
  const tpl = template ?? loadSystemPromptTemplate();
  return tpl.replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (_, expr) => evaluateExpression(expr, payload));
}

/** Backend'den gerçek bir SalonAgentContext alıp payload'a dönüştürür. */
export async function buildPayloadFromSalon(
  salonId: number,
  opts: { profileName?: string; repliedTo?: PromptRenderPayload['body']['repliedTo'] } = {},
): Promise<PromptRenderPayload> {
  const ctx = await loadSalonAgentContext(salonId);
  if (!ctx) throw new Error(`Salon ${salonId} not found`);
  return contextToPayload(ctx, opts);
}

/** Tam DB lookup gerektirmediği için fixture'larda doğrudan ctx üzerinden render. */
export function contextToPayload(
  ctx: SalonAgentContext,
  opts: { profileName?: string; repliedTo?: PromptRenderPayload['body']['repliedTo'] } = {},
): PromptRenderPayload {
  return {
    body: {
      toneDirective: ctx.toneDirective,
      styleDirective: ctx.styleDirective,
      salonOneLiner: ctx.salonOneLiner,
      profileName: opts.profileName,
      repliedTo: opts.repliedTo ?? null,
    },
  };
}
