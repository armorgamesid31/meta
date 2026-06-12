// Backend-native AI conversation agent — çekirdek tipler.
// (n8n→backend tam geçişin W1+W2+W3 temeli. İzole modül; canlı agent'a W6
//  cutover'a kadar dokunmaz. Plan: hatlar/kedy/agent-migration-plan.md)

export type AgentRole = 'user' | 'assistant';

/** Multimodal medya parçası (W5). Gemini görüntü+ses'i native işler; bytes
 *  modele image/file part olarak verilir. Yalnız mevcut (current-batch) inbound
 *  medyası modele gider; geçmiş medya hafızada metin/transkript olarak kalır. */
export interface AgentMediaPart {
  kind: 'image' | 'audio';
  mediaType: string; // örn. image/jpeg, audio/ogg
  data: Buffer | Uint8Array;
}

/** LLM context'ine giren temiz konuşma turu (tool-artifact YOK — halüsinasyon
 *  fix'i: ConversationMessageEvent'ten sadece müşteri sözü + asistanın gönderdiği
 *  temiz cevap yüklenir). Opsiyonel `media`: yalnız current-batch user turunda. */
export interface AgentMessage {
  role: AgentRole;
  content: string;
  media?: AgentMediaPart[];
}

/** Bir agent turunun yan-etkiye dönüşecek "niyeti". Çekirdek ilke: taslak
 *  turlarda yan-etkili tool'lar ÇALIŞMAZ, buraya kaydedilir; yalnız NİHAİ
 *  turda (re-check bitince) işlenir → re-run güvenli, çift-işlem yok. */
export interface ToolIntent {
  tool: string;
  args: Record<string, unknown>;
}

/** Nihai cevaba iliştirilecek buton (n8n paritesi: tek mesaj = metin + buton).
 *  Yan-etkili tool nihai turda butonu HAZIRLAR (mint/resolve), orkestratör
 *  AI'ın metniyle birleştirip TEK mesaj gönderir. */
export interface AgentButton {
  kind: 'location' | 'profile_edit' | 'booking';
  url: string;
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
  /** NİHAİ turda hazırlanan butonlar (orkestratör cevaba iliştirir). */
  buttons: AgentButton[];
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
