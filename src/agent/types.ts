// Backend-native AI conversation agent — çekirdek tipler.
// (n8n→backend tam geçişin W1+W2+W3 temeli. İzole modül; canlı agent'a W6
//  cutover'a kadar dokunmaz. Plan: hatlar/kedy/agent-migration-plan.md)

export type AgentRole = 'user' | 'assistant';

/** LLM context'ine giren temiz konuşma turu (tool-artifact YOK — halüsinasyon
 *  fix'i: ConversationMessageEvent'ten sadece müşteri sözü + asistanın gönderdiği
 *  temiz cevap yüklenir). */
export interface AgentMessage {
  role: AgentRole;
  content: string;
}

/** Bir agent turunun yan-etkiye dönüşecek "niyeti". Çekirdek ilke: taslak
 *  turlarda yan-etkili tool'lar ÇALIŞMAZ, buraya kaydedilir; yalnız NİHAİ
 *  turda (re-check bitince) işlenir → re-run güvenli, çift-işlem yok. */
export interface ToolIntent {
  tool: string;
  args: Record<string, unknown>;
}

/** Tool executor'larına geçen bağlam (her tur taze kurulur, ctx closure'lanır). */
export interface ToolContext {
  salonId: number;
  channel: string;
  conversationKey: string;
  canonicalUserId: string | null;
  customerId: number | null;
  /** true ise yan-etkili tool'lar niyeti `intents`'e yazar, çalıştırmaz. */
  draft: boolean;
  /** Taslak boyunca biriken yan-etki niyetleri (nihai turda işlenir). */
  intents: ToolIntent[];
}

export interface AgentTurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AgentTurnResult {
  /** AI'ın nihai metin cevabı (kullanıcıya gidecek). */
  text: string;
  /** Bu turda yapılan tool çağrıları (gözlem/debug/bench için). */
  toolCalls: { name: string; args: unknown }[];
  usage: AgentTurnUsage;
  /** Agent loop adım sayısı (tool→model döngüleri). */
  steps: number;
}
