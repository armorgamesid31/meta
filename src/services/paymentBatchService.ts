import type { PaymentMethod, Prisma } from '@prisma/client';

/**
 * PaymentBatch yardımcıları.
 *
 * Veri modeli özeti:
 *   PaymentBatch (toplam=N TL, kim için, ne zaman)
 *     ├── Payment (yöntem + tutar) × 1..N
 *     └── AppointmentPayment (batch ↔ appointment bağı) × 1..M
 *
 * Split senaryo örneği:
 *   4 hizmet × toplam 3000 TL, 300 kart + 2700 nakit
 *     → 1 PaymentBatch (totalAmount=3000)
 *       → 2 Payment (CARD 300, CASH 2700)
 *       → 4 AppointmentPayment (her hizmet appointment'ına bağlanır)
 *
 * Refund senaryosu:
 *   parentBatchId DOLU → iade batch'i, Payment.amount NEGATIF.
 *   Aynı appointmentId hem pozitif hem negatif batch'lere bağlı kalabilir.
 */

export type PaymentDraft = { method: PaymentMethod; amount: number };

type Tx = Prisma.TransactionClient;

const EPS = 0.005; // 1 kuruşun yarısı — float toplam karşılaştırmasında tolerans

/**
 * Birden fazla appointment için tek bir PaymentBatch oluşturur. Tek-yöntem
 * tahsilatta `payments` 1 elemanlı; split'te 2+.
 *
 * Sum kontrolü çağıran katmanın sorumluluğu; bu fonksiyon yalnız nominal
 * doğrulamaları (boş yok, amount > 0) yapar. Bu sayede çağıran hem
 * pozitif batch (Faz 2) hem refund batch (Faz 4) için aynı helper'ı
 * kullanabilir — negatif tutarlar refundBatchForAppointments() içinden gelir.
 */
export async function createBatchForAppointments(
  tx: Tx,
  input: {
    salonId: number;
    customerId: number | null;
    appointmentIds: number[];
    payments: PaymentDraft[];
    totalAmount: number;
    notes?: string | null;
    recordedAt?: Date;
    parentBatchId?: number | null;
  },
): Promise<{ batchId: number }> {
  if (!input.appointmentIds.length) {
    throw new Error('PaymentBatch için en az 1 appointment gerekli.');
  }
  if (!input.payments.length) {
    throw new Error('PaymentBatch için en az 1 ödeme kalemi gerekli.');
  }
  // Pozitif batch'lerde amount > 0; refund batch'lerde NEGATIF tutarlar
  // gelebileceği için yalnızca "sıfır olamaz" kontrolü.
  for (const p of input.payments) {
    if (!p.amount || !Number.isFinite(p.amount)) {
      throw new Error('Geçersiz ödeme tutarı.');
    }
  }

  const recordedAt = input.recordedAt || new Date();
  const batch = await tx.paymentBatch.create({
    data: {
      salonId: input.salonId,
      customerId: input.customerId,
      totalAmount: input.totalAmount,
      recordedAt,
      notes: input.notes || null,
      parentBatchId: input.parentBatchId || null,
      payments: {
        create: input.payments.map((p) => ({
          method: p.method,
          amount: p.amount,
          recordedAt,
        })),
      },
      appointmentPayments: {
        create: input.appointmentIds.map((appointmentId) => ({ appointmentId })),
      },
    },
    select: { id: true },
  });
  return { batchId: batch.id };
}

/**
 * Belirli appointment'lar için pozitif Payment tutarlarının toplamı.
 * Refund batch'leri (parentBatchId dolu, amount NEGATIF) net hesabı
 * korumak için SUM'a dahil — yani "ödenmiş net" gelir.
 */
export async function sumPaidForAppointments(
  tx: Tx,
  appointmentIds: number[],
): Promise<number> {
  if (!appointmentIds.length) return 0;
  const rows = await tx.appointmentPayment.findMany({
    where: { appointmentId: { in: appointmentIds } },
    select: { batch: { select: { payments: { select: { amount: true } } } } },
  });
  let sum = 0;
  for (const r of rows) {
    for (const p of r.batch.payments) sum += p.amount;
  }
  return sum;
}

/**
 * Bir veya birden fazla appointment için Payment kayıtlarını yöntem bazında
 * grupla. UI "₺300 Kart + ₺2700 Nakit" görüntülemesi için kullanılır.
 *
 * Aynı yöntemden birden fazla Payment olabilir (ör. 2 ayrı seferde nakit
 * tahsilat) — bunlar toplanır.
 */
export async function summarizePaymentsForAppointments(
  tx: Tx,
  appointmentIds: number[],
): Promise<{ method: PaymentMethod; amount: number }[]> {
  if (!appointmentIds.length) return [];
  const rows = await tx.appointmentPayment.findMany({
    where: { appointmentId: { in: appointmentIds } },
    select: {
      batch: {
        select: {
          payments: { select: { method: true, amount: true } },
        },
      },
    },
  });
  const totals = new Map<PaymentMethod, number>();
  for (const r of rows) {
    for (const p of r.batch.payments) {
      totals.set(p.method, (totals.get(p.method) || 0) + p.amount);
    }
  }
  return Array.from(totals.entries())
    .map(([method, amount]) => ({ method, amount }))
    .filter((x) => Math.abs(x.amount) > EPS);
}

/**
 * Sum doğrulama yardımcısı — payments.amount toplamı beklenen totalAmount
 * ile eşleşmeli (kuruş toleransı ile). Çağıran tarafın iş mantığı için.
 */
export function validatePaymentsTotal(
  payments: PaymentDraft[],
  expectedTotal: number,
): { ok: true } | { ok: false; sum: number; expected: number } {
  let sum = 0;
  for (const p of payments) sum += Number(p.amount || 0);
  if (Math.abs(sum - expectedTotal) > EPS) {
    return { ok: false, sum, expected: expectedTotal };
  }
  return { ok: true };
}

/**
 * Çağıran tarafın "primary method" damgalaması için: ilk Payment'ın
 * method'unu döner. AppointmentLine.paymentMethod geriye uyumluluk
 * alanı buna eşitlenir.
 */
export function primaryMethod(payments: PaymentDraft[]): PaymentMethod | null {
  for (const p of payments) {
    if (p.amount > 0) return p.method;
  }
  return payments[0]?.method ?? null;
}

/**
 * Verilen appointment'ların en son pozitif (parentBatchId=NULL) tahsilat
 * batch'ini bulur. Refund için "hangi batch'i iade ediyoruz" otomatik
 * çözümünde kullanılır. Birden fazla varsa en son recordedAt seçilir.
 */
export async function findLatestPositiveBatchForAppointments(
  tx: Tx,
  appointmentIds: number[],
): Promise<number | null> {
  if (!appointmentIds.length) return null;
  const rows = await tx.appointmentPayment.findMany({
    where: {
      appointmentId: { in: appointmentIds },
      batch: { parentBatchId: null },
    },
    select: { batchId: true, batch: { select: { recordedAt: true } } },
    orderBy: { batch: { recordedAt: 'desc' } },
    take: 1,
  });
  return rows[0]?.batchId ?? null;
}

/**
 * Refund için kolaylık: pozitif refundPayments al, negatif olarak yaz.
 * createBatchForAppointments üzerinde ince bir sarmal — caller'ın amount
 * işaretiyle uğraşmamasını sağlar.
 */
export async function createRefundBatch(
  tx: Tx,
  input: {
    salonId: number;
    customerId: number | null;
    appointmentIds: number[];
    refundPayments: PaymentDraft[];
    parentBatchId: number;
    notes?: string | null;
    recordedAt?: Date;
  },
): Promise<{ batchId: number; refundedAmount: number }> {
  let totalRefund = 0;
  const negPayments: PaymentDraft[] = input.refundPayments.map((p) => {
    const abs = Math.abs(Number(p.amount));
    totalRefund += abs;
    return { method: p.method, amount: -abs };
  });
  const { batchId } = await createBatchForAppointments(tx, {
    salonId: input.salonId,
    customerId: input.customerId,
    appointmentIds: input.appointmentIds,
    payments: negPayments,
    totalAmount: -totalRefund,
    notes: input.notes || null,
    recordedAt: input.recordedAt,
    parentBatchId: input.parentBatchId,
  });
  return { batchId, refundedAmount: totalRefund };
}
