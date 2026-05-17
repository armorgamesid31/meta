import { prisma } from '../prisma.js';

/**
 * Kanonik salon → AI agent context kaynağı.
 *
 * Tek bir yerde topluyoruz çünkü daha önce ton iki farklı yerden okunuyordu:
 *   - Frontend TonePicker → Salon.communicationTone (enum FRIENDLY/BALANCED/PROFESSIONAL)
 *   - n8n ai_agent.json  → SalonAiAgentSettings.tone (lowercase string)
 * İkisi senkron değildi → kullanıcı UI'dan ton değiştirse de agent eski tonla cevap veriyordu.
 *
 * Şimdi Salon.communicationTone tek doğru kaynak. SalonAiAgentSettings sadece "advanced"
 * davranış ayarları (answerLength, emojiUsage, bookingGuidance, handoverThreshold,
 * aiDisclosure) için kullanılıyor.
 */

export type AgentTone = 'friendly' | 'balanced' | 'professional';
export type AgentAnswerLength = 'short' | 'medium' | 'detailed';
export type AgentEmojiUsage = 'off' | 'low' | 'normal';
export type AgentBookingGuidance = 'low' | 'medium' | 'high';
export type AgentHandoverThreshold = 'early' | 'balanced' | 'late';
export type AgentAiDisclosure = 'always' | 'onQuestion' | 'never';

export interface AgentSettings {
  tone: AgentTone;
  answerLength: AgentAnswerLength;
  emojiUsage: AgentEmojiUsage;
  bookingGuidance: AgentBookingGuidance;
  handoverThreshold: AgentHandoverThreshold;
  aiDisclosure: AgentAiDisclosure;
}

export interface SalonInfo {
  salonId: number;
  name: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  googleMapsUrl: string | null;
  instagramUrl: string | null;
  whatsappPhone: string | null;
  tagline: string | null;
  about: string | null;
  timezone: string;
  workStartHour: number;
  workEndHour: number;
  slotInterval: number;
  workingDays: unknown;
  commonQuestions: unknown;
}

export interface SalonAgentContext {
  salonInfo: SalonInfo;
  agentSettings: AgentSettings;
  /** Tek satırlık ton kuralı — n8n bunu prompt'a direkt yapıştırır. */
  toneDirective: string;
  /** Tek satırlık cevap uzunluğu + emoji + handover kuralı (merged). */
  styleDirective: string;
  /** "Salon: X, Şehir: Y, Saat: 09:00-19:00" gibi tek satır context — token tasarrufu. */
  salonOneLiner: string;
}

const TONE_ENUM_TO_LOWER: Record<string, AgentTone> = {
  FRIENDLY: 'friendly',
  BALANCED: 'balanced',
  PROFESSIONAL: 'professional',
};

function normalizeTone(raw: unknown): AgentTone {
  if (typeof raw === 'string') {
    const upper = raw.toUpperCase();
    if (upper in TONE_ENUM_TO_LOWER) return TONE_ENUM_TO_LOWER[upper];
    const lower = raw.toLowerCase();
    if (lower === 'friendly' || lower === 'balanced' || lower === 'professional') return lower;
  }
  return 'balanced';
}

function normalizeAnswerLength(raw: unknown): AgentAnswerLength {
  return raw === 'short' || raw === 'detailed' ? raw : 'medium';
}
function normalizeEmoji(raw: unknown): AgentEmojiUsage {
  return raw === 'off' || raw === 'normal' ? raw : 'low';
}
function normalizeBookingGuidance(raw: unknown): AgentBookingGuidance {
  return raw === 'low' || raw === 'high' ? raw : 'medium';
}
function normalizeHandover(raw: unknown): AgentHandoverThreshold {
  return raw === 'early' || raw === 'late' ? raw : 'balanced';
}
function normalizeAiDisclosure(raw: unknown): AgentAiDisclosure {
  return raw === 'always' || raw === 'never' ? raw : 'onQuestion';
}

/**
 * Aktif tonun "tek satırlık reçetesi". Sistem prompt'ta sadece bu satır görünür —
 * 3 tonu da prompt'a basıp LLM'in seçmesine bırakmaktan token-verimli ve daha net.
 */
const TONE_DIRECTIVES: Record<AgentTone, string> = {
  friendly:
    'Sıcak, samimi ve içten konuş. Müşteriye "sen" diye hitap et, varsa adıyla seslen. ' +
    'Kuaför arkadaşı gibi: küçük sıcaklıklar, davetkâr cümleler. Emoji ayarı izin verirse 1 emoji uygundur.',
  balanced:
    'Zarif, dengeli ve saygılı konuş. Yetişkin müşteriye "Hanım/Bey" hitabı kullan, ölçülü ol. ' +
    'Sıcak ama mesafeli — abartmadan, davetkâr ama profesyonel.',
  professional:
    'Kurumsal, net ve resmi konuş. "Sayın [Ad]" hitabı kullan, kısa ve mesafeli cümleler kur. ' +
    'Emoji kullanma. Lüks/klinik bir kurumun resepsiyon dili.',
};

const ANSWER_LENGTH_RULES: Record<AgentAnswerLength, string> = {
  short: '1-2 kısa cümle',
  medium: '2-3 net cümle',
  detailed: '3-4 cümle, gerekirse kısa madde işareti',
};

const EMOJI_RULES: Record<AgentEmojiUsage, string> = {
  off: 'emoji yok',
  low: 'en fazla 1 emoji ve sadece vurgu noktasında',
  normal: '1-2 emoji uygun',
};

const BOOKING_GUIDANCE_RULES: Record<AgentBookingGuidance, string> = {
  low: 'Randevu önerisini sadece müşteri açıkça isterse yap',
  medium: 'Hizmet/fiyat sorusunda "istersen sana randevu linki gönderebilirim" şeklinde yumuşak öner',
  high: 'Hizmet/fiyat/uygunluk sorularında proaktif olarak randevu linki teklif et',
};

const HANDOVER_RULES: Record<AgentHandoverThreshold, string> = {
  early: 'Belirsizlik, şikayet, özel istek veya ödeme/randevu kaydı değişikliklerinde insan temsilciye devret',
  balanced: 'Şikayet, ödeme ihtilafı, agresif dil veya randevu güncelleme talebinde insan temsilciye devret',
  late: 'Sadece açık handover talebinde veya ciddi bir risk (yasal, sağlık) algılanırsa insan temsilciye devret',
};

const AI_DISCLOSURE_RULES: Record<AgentAiDisclosure, string> = {
  always: 'İlk yanıtının başında kısaca AI asistan olduğunu belirt',
  onQuestion: 'AI olup olmadığın sorulursa dürüstçe söyle, aksi halde belirtme',
  never: 'AI olduğunu kendiliğinden belirtme; sorulursa salonun dijital asistanı olduğunu söyle',
};

function buildStyleDirective(s: AgentSettings): string {
  return [
    `Cevap uzunluğu: ${ANSWER_LENGTH_RULES[s.answerLength]}.`,
    `Emoji: ${EMOJI_RULES[s.emojiUsage]}.`,
    `Randevu yönlendirme: ${BOOKING_GUIDANCE_RULES[s.bookingGuidance]}.`,
    `Handover: ${HANDOVER_RULES[s.handoverThreshold]}.`,
    `Açıklama: ${AI_DISCLOSURE_RULES[s.aiDisclosure]}.`,
  ].join(' ');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function buildSalonOneLiner(info: SalonInfo): string {
  const parts: string[] = [];
  if (info.name) parts.push(`Salon: ${info.name}`);
  const place = [info.district, info.city].filter(Boolean).join(', ');
  if (place) parts.push(`Konum: ${place}`);
  parts.push(`Çalışma saatleri: ${pad2(info.workStartHour)}:00–${pad2(info.workEndHour)}:00 (${info.timezone})`);
  if (Array.isArray(info.workingDays) && info.workingDays.length) {
    parts.push(`Açık günler: ${info.workingDays.join(', ')}`);
  }
  return parts.join(' · ');
}

/**
 * Kanonik agent context'i tek sorguda toplar.
 * - Salon.communicationTone enum'unu kullan; geçerli değilse default 'balanced'.
 * - SalonAiAgentSettings'in tone alanı IGNORE EDİLİR (legacy split kaynağı).
 * - SalonAiAgentSettings'in diğer alanları advanced override sayılır.
 */
export async function loadSalonAgentContext(salonId: number): Promise<SalonAgentContext | null> {
  const [salon, advanced] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        id: true,
        name: true,
        city: true,
        district: true,
        address: true,
        googleMapsUrl: true,
        instagramUrl: true,
        whatsappPhone: true,
        tagline: true,
        about: true,
        communicationTone: true,
        settings: {
          select: {
            workStartHour: true,
            workEndHour: true,
            slotInterval: true,
            workingDays: true,
            timezone: true,
            commonQuestions: true,
          },
        },
      },
    }),
    prisma.salonAiAgentSettings.findUnique({
      where: { salonId },
      select: {
        answerLength: true,
        emojiUsage: true,
        bookingGuidance: true,
        handoverThreshold: true,
        aiDisclosure: true,
      },
    }),
  ]);

  if (!salon) return null;

  const settings = salon.settings;

  const salonInfo: SalonInfo = {
    salonId,
    name: salon.name || null,
    city: salon.city || null,
    district: salon.district || null,
    address: salon.address || null,
    googleMapsUrl: (salon as any).googleMapsUrl || null,
    instagramUrl: (salon as any).instagramUrl || null,
    whatsappPhone: (salon as any).whatsappPhone || null,
    tagline: (salon as any).tagline || null,
    about: (salon as any).about || null,
    timezone: settings?.timezone || 'Europe/Istanbul',
    workStartHour: settings?.workStartHour ?? 9,
    workEndHour: settings?.workEndHour ?? 18,
    slotInterval: settings?.slotInterval ?? 30,
    workingDays: settings?.workingDays ?? null,
    commonQuestions: settings?.commonQuestions ?? null,
  };

  const agentSettings: AgentSettings = {
    tone: normalizeTone(salon.communicationTone),
    answerLength: normalizeAnswerLength(advanced?.answerLength),
    emojiUsage: normalizeEmoji(advanced?.emojiUsage),
    bookingGuidance: normalizeBookingGuidance(advanced?.bookingGuidance),
    handoverThreshold: normalizeHandover(advanced?.handoverThreshold),
    aiDisclosure: normalizeAiDisclosure(advanced?.aiDisclosure),
  };

  return {
    salonInfo,
    agentSettings,
    toneDirective: TONE_DIRECTIVES[agentSettings.tone],
    styleDirective: buildStyleDirective(agentSettings),
    salonOneLiner: buildSalonOneLiner(salonInfo),
  };
}

/**
 * UI'dan ton güncellendiğinde çağrılır — Salon.communicationTone kanonik kaynaktır
 * ama eski kod hâlâ SalonAiAgentSettings.tone okuyor olabilir. Defansif sync.
 */
export async function syncAgentSettingsTone(salonId: number, tone: AgentTone): Promise<void> {
  await prisma.salonAiAgentSettings.upsert({
    where: { salonId },
    update: { tone },
    create: { salonId, tone },
  });
}

export const __testing = {
  TONE_DIRECTIVES,
  normalizeTone,
  buildStyleDirective,
  buildSalonOneLiner,
};
