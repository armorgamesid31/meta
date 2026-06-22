/**
 * Kurucu Salon 4-tier kampanya kilit servisi.
 *
 * Kademe = GÖSTERİLEN sayıdan (computeDisplayCount, ~187 tabandan) belirlenir,
 * ham sequence rank'ten değil → müşterinin gördüğü fiyat = kilitlenen fiyat.
 * Price'lar env'den okunur (kod hard-code etmez):
 *   tier1: gösterilen 1-100   -> 599 TL · TIER1 env (DOLU/sadece gösterim, kullanılmaz)
 *   tier2: gösterilen 101-250 -> 699 TL · TIER1 env (MEVCUT canlı price, AKTİF)
 *   tier3: gösterilen 251-400 -> 899 TL · TIER3 env
 *   tier4: gösterilen 401-500 -> 999 TL · STRIPE_PRICE_PROFESSIONAL_PLUS (mevcut)
 *   after_campaign: 501+ -> kampanya sonrası fiyat (1.999) Stripe'da ayrı yok;
 *                           null döndürülür, checkout env fallback'e düşer
 *                           (tier4 = STRIPE_PRICE_PROFESSIONAL_PLUS).
 *
 * RACE-SAFETY: salon REAL sırası PostgreSQL native sequence
 * (salon_campaign_signup_rank_seq) üzerinden nextval() ile alınır. Aynı
 * anda 100 salon kaydolsa bile her biri benzersiz, ardışık sıra alır —
 * Postgres sequence semantiği zaten atomiktir. Sequence sonucu salon
 * satırına yazılır ve "Salon"."campaignSignupRank" üzerindeki UNIQUE
 * INDEX double-lock'a karşı belt-and-suspenders koruma sağlar.
 *
 * IDEMPOTENT: aynı salon için ikinci çağrı no-op (zaten damgalı sırayı
 * döndürür, yeni sequence yakılmaz).
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../prisma.js';

export type CampaignTierKey = 'tier1' | 'tier2' | 'tier3' | 'tier4' | 'after_campaign';

export interface CampaignTierConfig {
  readonly key: CampaignTierKey;
  /** Bu tier'ın kapsadığı son sıra (dahil). after_campaign için Infinity. */
  readonly maxRank: number;
  /** Aylık price'ın env değişkeni adı. */
  readonly monthlyEnv: string;
  /** Yıllık price'ın env değişkeni adı. */
  readonly annualEnv: string;
  /** Aylık fiyat TRY (sayaç + UI için referans değer). */
  readonly monthlyAmount: number;
  /** Yıllık fiyat TRY (sayaç + UI için referans değer). */
  readonly annualAmount: number;
}

/**
 * Kapasite: 4 tier × kapsam. after_campaign listede yok (sayaç
 * görüntüsünde 500'üncü salondan sonra "kampanya kapandı" denir).
 */
export const CAMPAIGN_TIERS: readonly CampaignTierConfig[] = [
  {
    // SADECE GÖSTERİM: bu kademe "dolu" gösterilir (sayaç 187'den başlar);
    // hiçbir yeni salon buraya düşmediği için monthlyEnv/annualEnv hiç
    // kullanılmaz (yeni Stripe price'a gerek yok).
    key: 'tier1',
    maxRank: 100,
    monthlyEnv: 'STRIPE_PRICE_KURUCU_TIER1_MONTHLY',
    annualEnv: 'STRIPE_PRICE_KURUCU_TIER1_ANNUAL',
    monthlyAmount: 599,
    annualAmount: 5990,
  },
  {
    // AKTİF kademe (101-250). 699 = MEVCUT TIER1 Stripe price'ı (zaten canlı) —
    // bu yüzden tier2, TIER1 env'ine işaret eder; yeni price yaratılmaz.
    key: 'tier2',
    maxRank: 250,
    monthlyEnv: 'STRIPE_PRICE_KURUCU_TIER1_MONTHLY',
    annualEnv: 'STRIPE_PRICE_KURUCU_TIER1_ANNUAL',
    monthlyAmount: 699,
    annualAmount: 6990,
  },
  {
    key: 'tier3',
    maxRank: 400,
    monthlyEnv: 'STRIPE_PRICE_KURUCU_TIER3_MONTHLY',
    annualEnv: 'STRIPE_PRICE_KURUCU_TIER3_ANNUAL',
    monthlyAmount: 899,
    annualAmount: 8990,
  },
  {
    key: 'tier4',
    maxRank: 500,
    monthlyEnv: 'STRIPE_PRICE_PROFESSIONAL_PLUS',
    annualEnv: 'STRIPE_PRICE_PROFESSIONAL_PLUS_ANNUAL',
    monthlyAmount: 999,
    annualAmount: 9999,
  },
] as const;

/* ───── GÖSTERİLEN kampanya sayacı: 187 taban + günlük 2-5 deterministik ─────
 * Cron/migration/yeni-tablo YOK: padding her istekte lansman tarihinden
 * deterministik hesaplanır. Hem sayaç görüntüsü hem yeni kaydın kademe/fiyatı
 * bu tek kaynaktan türer → müşterinin gördüğü fiyat = kilitlenen fiyat. */

/** Kampanyanın "187. salondayız" başlangıç anı (UTC). */
const CAMPAIGN_LAUNCH_UTC = Date.UTC(2026, 5, 22); // 22 Haziran 2026
/** Sayaç bu değerden başlar — sanki 187 salon zaten kayıtlıymış gibi. */
const CAMPAIGN_DISPLAY_BASE = 187;

/** Belirli bir gün için deterministik [2,5] artış (klasik hash, durum tutmaz). */
function dailyPadding(dayIndex: number): number {
  const h = Math.sin((dayIndex + 1) * 12.9898) * 43758.5453;
  const frac = h - Math.floor(h);
  return 2 + Math.floor(frac * 4); // 2,3,4,5
}

/** Lansmandan bugüne kümülatif padding. Gün 0 = 0 (sayaç tam 187'de başlar). */
function paddingSinceLaunch(now = new Date()): number {
  const days = Math.max(
    0,
    Math.floor((now.getTime() - CAMPAIGN_LAUNCH_UTC) / 86_400_000),
  );
  let sum = 0;
  for (let d = 0; d < days; d++) sum += dailyPadding(d);
  return sum;
}

/**
 * GÖSTERİLEN sayı = max(187 + padding, gerçek damgalanmış max). Gerçek kayıt
 * padding'i geçerse gerçek değer kazanır (sayacı asla küçültmez).
 */
export function computeDisplayCount(realMax: number): number {
  const padded = CAMPAIGN_DISPLAY_BASE + paddingSinceLaunch();
  const real = realMax > 0 ? realMax : 0;
  // Sahte padding kampanyayı KAPATMASIN: gösterilen sayıyı son kademenin hemen
  // altında tut → kampanya hep "açık" kalır, fiyat kademe kademe yükselir ama
  // takvimle bitmez. GERÇEK kayıt 500'ü geçerse kampanya gerçek talep ile kapanır.
  const lastMax = CAMPAIGN_TIERS[CAMPAIGN_TIERS.length - 1].maxRank;
  return Math.max(Math.min(padded, lastMax - 1), real);
}

/**
 * Verilen sıraya hangi tier düşüyor? 501+ için null döner —
 * caller'lar bunu "after_campaign" olarak ele alır ve checkout'ta
 * STRIPE_PRICE_PROFESSIONAL_PLUS (env) fallback'ine düşer.
 */
export function tierForRank(rank: number): CampaignTierConfig | null {
  if (!Number.isFinite(rank) || rank <= 0) return null;
  for (const tier of CAMPAIGN_TIERS) {
    if (rank <= tier.maxRank) return tier;
  }
  return null;
}

/** Env'den price id oku, boşsa null. Trim + cast. */
function readEnvPriceId(envKey: string): string | null {
  const raw = String(process.env[envKey] || '').trim();
  return raw || null;
}

export interface AllocateCampaignRankResult {
  /** Salonun aldığı global sıra (1-tabanlı). */
  readonly rank: number;
  /** Bu sıraya düşen tier key — kapsam dışı 501+ için 'after_campaign'. */
  readonly tier: CampaignTierKey;
  /** Salonun aylık ödeme için kilitlenmiş Stripe price id'si. null = env fallback. */
  readonly monthlyPriceId: string | null;
  /** Salonun yıllık ödeme için kilitlenmiş Stripe price id'si. null = env fallback. */
  readonly annualPriceId: string | null;
}

type TxOrPrisma = Prisma.TransactionClient | PrismaClient;

/**
 * Salona atomik global sıra ver ve tier price'larını kilitle.
 *
 * Idempotent: salon zaten kampanya kapsamına alınmışsa
 * (campaignSignupRank IS NOT NULL), DB'deki mevcut değerler döndürülür
 * ve sequence YAKILMAZ. İlk çağrıda nextval('salon_campaign_signup_rank_seq')
 * ile race-safe sıra alınır, tier hesaplanır ve salon satırına yazılır.
 *
 * @param db prisma client veya transaction client (salon yaratma
 *           transaction'ı sırasında çağrılabilsin diye opsiyonel).
 */
export async function allocateCampaignRankAndLock(
  db: TxOrPrisma,
  salonId: number,
): Promise<AllocateCampaignRankResult> {
  // 1. Idempotency: zaten kilitliyse mevcut değerleri döndür.
  const existing = await db.salon.findUnique({
    where: { id: salonId },
    select: {
      campaignSignupRank: true,
      campaignTier: true,
      campaignLockedMonthlyPriceId: true,
      campaignLockedAnnualPriceId: true,
    },
  });
  if (!existing) {
    throw new Error(`CAMPAIGN_TIER_SALON_NOT_FOUND:${salonId}`);
  }
  if (existing.campaignSignupRank != null && existing.campaignTier) {
    return {
      rank: existing.campaignSignupRank,
      tier: existing.campaignTier as CampaignTierKey,
      monthlyPriceId: existing.campaignLockedMonthlyPriceId || null,
      annualPriceId: existing.campaignLockedAnnualPriceId || null,
    };
  }

  // 2. Atomik sıra al (PostgreSQL sequence). Aynı anda gelen N istek
  //    Postgres tarafında serileştirilir; her biri benzersiz değer alır.
  const seqRows = await db.$queryRaw<{ rank: bigint }[]>`
    SELECT nextval('salon_campaign_signup_rank_seq') AS rank
  `;
  const rank = Number(seqRows[0]?.rank || 0);
  if (!rank || rank < 1) {
    throw new Error('CAMPAIGN_TIER_SEQUENCE_FAILED');
  }

  // 3. Tier hesapla. Kademe ham sequence rank'ten DEĞİL GÖSTERİLEN sayıdan
  //    belirlenir → müşterinin gördüğü "Kademe N açık" ile kilitlenen fiyat
  //    tutarlı olur. +1: yeni salon gösterilen sayının BİR SONRAKİ slotuna
  //    düşer → getCampaignCounters'ın "aktif kademe" (dolu kademeyi atlar)
  //    mantığıyla sınır günlerinde de birebir aynı kademeye oturur.
  const tierConfig = tierForRank(computeDisplayCount(rank) + 1);
  const tierKey: CampaignTierKey = tierConfig ? tierConfig.key : 'after_campaign';
  const monthlyPriceId = tierConfig ? readEnvPriceId(tierConfig.monthlyEnv) : null;
  const annualPriceId = tierConfig ? readEnvPriceId(tierConfig.annualEnv) : null;

  // 4. Salon satırına yaz. UNIQUE INDEX double-lock'a karşı son güvence:
  //    eğer (imkansız olsa da) iki istek aynı rank'i almaya çalışırsa
  //    Prisma P2002 atar ve caller graceful degradation'a düşer.
  await db.salon.update({
    where: { id: salonId },
    data: {
      campaignSignupRank: rank,
      campaignTier: tierKey,
      campaignLockedMonthlyPriceId: monthlyPriceId,
      campaignLockedAnnualPriceId: annualPriceId,
      campaignLockedAt: new Date(),
    },
  });

  return {
    rank,
    tier: tierKey,
    monthlyPriceId,
    annualPriceId,
  };
}

export interface CampaignTierCounter {
  readonly key: CampaignTierKey;
  /** Bu tier'ın toplam kapasitesi. */
  readonly capacity: number;
  /** Şu ana kadar dolan slot sayısı (bu tier içinde damgalanmış salon sayısı). */
  readonly filled: number;
  /** Kalan slot. */
  readonly remaining: number;
  readonly monthlyAmount: number;
  readonly annualAmount: number;
  /** Şu anda hala satılıyor mu? true = bir alt tier daha doldurulmamış. */
  readonly active: boolean;
}

export interface CampaignCountersResult {
  readonly tiers: CampaignTierCounter[];
  /** Toplam kampanya kapasitesi (500). */
  readonly totalCapacity: number;
  /** Şu ana kadar damgalanmış toplam kampanya salonu sayısı. */
  readonly totalFilled: number;
  /** Şu an aktif olan tier (henüz dolmamış olan en düşük). null = kampanya bitti. */
  readonly currentTier: CampaignTierKey | null;
}

/**
 * Frontend canlı sayaç için tier doluluk durumunu getirir. CACHE-FRIENDLY:
 * tek bir COUNT sorgusu ve 4 aritmetik bucket — n^2 değil.
 *
 * Filled sayımı için "Salon"."campaignSignupRank" üzerinde range query
 * kullanılır (sequence'den daha iyi — silinmiş/iptal edilmiş kayıt da
 * sayılmalı çünkü sıra "kullanılmış" sayılır; sequence değeri zaten
 * geri verilemez).
 *
 * NOT: sequence.last_value de sayım için kullanılabilirdi ama silinmiş
 * salonları sayardı. Mevcut salon'lara bakmak daha doğru — bir salon
 * silinirse sırası boş kalır ama bir sonraki salon yine bir sonraki
 * sequence değerini alır. Yani filled = currentRank, kapasiteyi
 * sequence değil DB'den oku.
 */
export async function getCampaignCounters(
  db: TxOrPrisma = prisma,
): Promise<CampaignCountersResult> {
  // Tek sorgu: damgalanmış maksimum sıra (= filled toplam).
  const maxRows = await db.$queryRaw<{ max: number | null }[]>`
    SELECT MAX("campaignSignupRank")::int AS max
    FROM "Salon"
    WHERE "campaignSignupRank" IS NOT NULL
  `;
  const realMax = Number(maxRows[0]?.max || 0);
  // GÖSTERİLEN sayı: 187 taban + günlük padding (gerçek kaydı asla küçültmez).
  const totalFilled = computeDisplayCount(realMax);

  // Tier'ları doldur. Her tier'ın filled değeri = bu tier'ın
  // alt sınırından totalFilled'a kadar olan kapsam (cap'lı).
  let prevMax = 0;
  const tiers: CampaignTierCounter[] = CAMPAIGN_TIERS.map((tier) => {
    const lowerBound = prevMax + 1; // bu tier'ın ilk slot'u
    const upperBound = tier.maxRank;
    const capacity = upperBound - prevMax;
    // Bu tier içinde dolan slot sayısı:
    //   totalFilled < lowerBound  -> 0
    //   totalFilled > upperBound  -> capacity (dolu)
    //   arada                     -> totalFilled - prevMax
    let filled = 0;
    if (totalFilled >= upperBound) {
      filled = capacity;
    } else if (totalFilled >= lowerBound) {
      filled = totalFilled - prevMax;
    }
    const remaining = Math.max(0, capacity - filled);
    const active = filled < capacity && totalFilled < upperBound;
    prevMax = upperBound;
    return {
      key: tier.key,
      capacity,
      filled,
      remaining,
      monthlyAmount: tier.monthlyAmount,
      annualAmount: tier.annualAmount,
      active,
    };
  });

  // Toplam kapasite = son tier'ın maxRank'i (kapsamlar ardışık olduğu için).
  const totalCapacity = CAMPAIGN_TIERS[CAMPAIGN_TIERS.length - 1].maxRank;

  // currentTier: ilk aktif olan tier (yoksa null = kampanya bitti).
  const currentTier = tiers.find((t) => t.active)?.key || null;

  return {
    tiers,
    totalCapacity,
    totalFilled,
    currentTier,
  };
}
