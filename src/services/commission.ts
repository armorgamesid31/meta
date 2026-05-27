// Commission/Prim hesaplama servisi.
//
// İki ana entry-point:
//   - `applyCommissionForAppointment(appointmentId)`  → bir randevu
//     COMPLETED'a geçtiğinde appointment + appointmentLines için
//     CommissionEntry'leri oluştur veya günceller.
//   - `cancelCommissionForAppointment(appointmentId)` → randevu iptal
//     edildi / no-show / geri alındı → PENDING entry'leri CANCELLED'a
//     çevir, PAID olanlara dokunma (denetim için).
//
// Hesaplama hiyerarşisi (en spesifik kazanır):
//   1. CommissionRule (staff+service)  — bu çift için override
//   2. CommissionRule (staff+null)     — bu staff'ın "tüm hizmetler" override'ı
//   3. Staff.commissionRate            — çalışanın genel oranı
//   4. Service.defaultCommissionRate   — hizmetin default oranı
//   5. 0                                — prim yok
//
// `isExcluded = true` ise hesaplama tamamen iptal — entry oluşturma.

import type { Prisma, PrismaClient } from '@prisma/client';

type TxClient = Prisma.TransactionClient | PrismaClient;

export const COMMISSION_ENTRY_TYPES = ['SERVICE', 'BONUS', 'MANUAL_ADJUST', 'DEDUCTION'] as const;
export type CommissionEntryType = (typeof COMMISSION_ENTRY_TYPES)[number];

export const COMMISSION_ENTRY_STATUSES = ['PENDING', 'PAID', 'CANCELLED'] as const;
export type CommissionEntryStatus = (typeof COMMISSION_ENTRY_STATUSES)[number];

export const COMMISSION_BONUS_TYPES = [
  'APPOINTMENT_COUNT',
  'REVENUE_THRESHOLD',
  'COMMISSION_THRESHOLD',
] as const;
export type CommissionBonusType = (typeof COMMISSION_BONUS_TYPES)[number];

// 'YYYY-MM' formatı. Backend'in tek kaynağı — frontend de aynı format
// kullanmalı ki listeleme/payout sorguları çalışsın.
export function periodKeyFor(date: Date | string | null | undefined): string {
  const d = date instanceof Date ? date : (date ? new Date(date) : new Date());
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const y = safe.getUTCFullYear();
  const m = String(safe.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

interface ResolvedRate {
  rate: number | null;       // % (0-100)
  fixedAmount: number | null; // ₺
  isExcluded: boolean;
  sourceRuleId: number | null;
  sourceType: 'RULE_SPECIFIC' | 'RULE_STAFF_ALL' | 'STAFF_DEFAULT' | 'SERVICE_DEFAULT' | 'NONE';
}

/**
 * Bir staff×service çifti için efektif oran/sabit miktarı çözer.
 * Çağıran kod hesaplama yaparken `isExcluded` true gelirse hiç entry
 * oluşturmamalı; `fixedAmount` öncelikli, sonra `rate`, sonra 0.
 */
export async function resolveCommissionRate(
  tx: TxClient,
  params: { salonId: number; staffId: number; serviceId: number },
): Promise<ResolvedRate> {
  const { salonId, staffId, serviceId } = params;

  // Staff+service spesifik kural
  const specific = await tx.commissionRule.findFirst({
    where: { salonId, staffId, serviceId, isActive: true },
  });
  if (specific) {
    return {
      rate: specific.rate ?? null,
      fixedAmount: specific.fixedAmount ?? null,
      isExcluded: specific.isExcluded,
      sourceRuleId: specific.id,
      sourceType: 'RULE_SPECIFIC',
    };
  }

  // Staff geneli (serviceId=null) kural
  const staffWide = await tx.commissionRule.findFirst({
    where: { salonId, staffId, serviceId: null, isActive: true },
  });
  if (staffWide) {
    return {
      rate: staffWide.rate ?? null,
      fixedAmount: staffWide.fixedAmount ?? null,
      isExcluded: staffWide.isExcluded,
      sourceRuleId: staffWide.id,
      sourceType: 'RULE_STAFF_ALL',
    };
  }

  // Staff.commissionRate fallback
  const staff = await tx.staff.findFirst({ where: { id: staffId, salonId } });
  if (staff && staff.commissionRate != null) {
    return {
      rate: staff.commissionRate,
      fixedAmount: null,
      isExcluded: false,
      sourceRuleId: null,
      sourceType: 'STAFF_DEFAULT',
    };
  }

  // Service.defaultCommissionRate fallback
  const service = await tx.service.findFirst({ where: { id: serviceId, salonId } });
  if (service && service.defaultCommissionRate != null) {
    return {
      rate: service.defaultCommissionRate,
      fixedAmount: null,
      isExcluded: false,
      sourceRuleId: null,
      sourceType: 'SERVICE_DEFAULT',
    };
  }

  return {
    rate: null,
    fixedAmount: null,
    isExcluded: false,
    sourceRuleId: null,
    sourceType: 'NONE',
  };
}

function computeAmount(baseAmount: number, resolved: ResolvedRate): number {
  if (resolved.fixedAmount != null) return resolved.fixedAmount;
  if (resolved.rate != null) {
    // Yüzde olarak yorumla (örn. 25 → %25)
    return Math.round(baseAmount * (resolved.rate / 100) * 100) / 100;
  }
  return 0;
}

/**
 * Randevu COMPLETED'a geçtiğinde çağrılır. Idempotent: zaten oluşturulmuş
 * entry'ler (appointmentLineId üzerinden) varsa yenisini eklemez,
 * sadece eksik olanları açar. Tekrar tekrar çağrılabilir.
 */
export async function applyCommissionForAppointment(
  prisma: PrismaClient,
  appointmentId: number,
): Promise<{ created: number; skipped: number }> {
  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId },
    include: { appointmentLines: true },
  });
  if (!appt) return { created: 0, skipped: 0 };

  // Sadece tamamlanmış randevulara prim hesapla. CANCELLED/NO_SHOW/BOOKED
  // gelirse caller hata almamalı — sessizce 0 dön.
  if (appt.status !== 'COMPLETED') {
    return { created: 0, skipped: 0 };
  }

  const period = periodKeyFor(appt.startTime || appt.createdAt);
  let created = 0;
  let skipped = 0;

  await prisma.$transaction(async (tx) => {
    // İki şekil var:
    //   1. AppointmentLine'lar varsa (multi-line randevular için): her
    //      satırı kendi specialistId + serviceId + finalPrice ile değerle.
    //   2. Line yoksa (legacy single-service randevu): Appointment.staffId
    //      + serviceId + (finalPrice || listPrice || service.price) ile
    //      tek entry aç.
    const lines = appt.appointmentLines;

    if (lines.length > 0) {
      for (const line of lines) {
        const staffId = line.specialistId ?? appt.staffId;
        if (!staffId) continue;
        const serviceId = line.serviceId;
        const base = line.finalPrice ?? line.listPrice ?? 0;

        // Idempotent kontrol — bu line için zaten bir entry varsa atla.
        const existing = await tx.commissionEntry.findFirst({
          where: { appointmentLineId: line.id, type: 'SERVICE' },
        });
        if (existing) {
          skipped += 1;
          continue;
        }

        const resolved = await resolveCommissionRate(tx, {
          salonId: appt.salonId,
          staffId,
          serviceId,
        });
        if (resolved.isExcluded) {
          skipped += 1;
          continue;
        }
        const amount = computeAmount(base, resolved);
        if (amount <= 0) {
          skipped += 1;
          continue;
        }

        await tx.commissionEntry.create({
          data: {
            salonId: appt.salonId,
            staffId,
            appointmentId: appt.id,
            appointmentLineId: line.id,
            periodKey: period,
            baseAmount: base,
            rate: resolved.fixedAmount == null ? resolved.rate : null,
            fixedAmount: resolved.fixedAmount,
            amount,
            type: 'SERVICE',
            status: 'PENDING',
            sourceRuleId: resolved.sourceRuleId,
          },
        });
        created += 1;
      }
    } else {
      // Single-service randevu (line yok)
      const staffId = appt.staffId;
      const serviceId = appt.serviceId;
      const base = appt.finalPrice ?? appt.listPrice ?? 0;

      const existing = await tx.commissionEntry.findFirst({
        where: { appointmentId: appt.id, appointmentLineId: null, type: 'SERVICE' },
      });
      if (existing) {
        skipped += 1;
        return;
      }

      const resolved = await resolveCommissionRate(tx, {
        salonId: appt.salonId,
        staffId,
        serviceId,
      });
      if (resolved.isExcluded) {
        skipped += 1;
        return;
      }
      const amount = computeAmount(base, resolved);
      if (amount > 0) {
        await tx.commissionEntry.create({
          data: {
            salonId: appt.salonId,
            staffId,
            appointmentId: appt.id,
            appointmentLineId: null,
            periodKey: period,
            baseAmount: base,
            rate: resolved.fixedAmount == null ? resolved.rate : null,
            fixedAmount: resolved.fixedAmount,
            amount,
            type: 'SERVICE',
            status: 'PENDING',
            sourceRuleId: resolved.sourceRuleId,
          },
        });
        created += 1;
      } else {
        skipped += 1;
      }
    }
  });

  return { created, skipped };
}

/**
 * Randevu COMPLETED'tan çıktığında / iptal edildiğinde çağrılır.
 * PENDING SERVICE entry'lerini CANCELLED'a çevirir (PAID'e dokunmaz —
 * denetim için kayıt korunur, ama gelecek payout'tan etkilenmez).
 */
export async function cancelCommissionForAppointment(
  prisma: PrismaClient,
  appointmentId: number,
): Promise<{ cancelled: number }> {
  const result = await prisma.commissionEntry.updateMany({
    where: {
      appointmentId,
      type: 'SERVICE',
      status: 'PENDING',
    },
    data: { status: 'CANCELLED' },
  });
  return { cancelled: result.count };
}

interface SummaryRow {
  staffId: number;
  staffName: string;
  periodKey: string;
  pendingTotal: number;
  paidTotal: number;
  cancelledTotal: number;
  pendingCount: number;
  serviceTotal: number;
  bonusTotal: number;
  manualTotal: number;
  deductionTotal: number;
}

/**
 * Belirli bir dönemde her staff için agregasyon.
 * UI'daki "Bu ay X'in toplam primi şu kadar" kartlarını besler.
 */
export async function getCommissionSummary(
  prisma: PrismaClient,
  params: { salonId: number; periodKey: string; staffId?: number },
): Promise<SummaryRow[]> {
  const { salonId, periodKey, staffId } = params;
  const entries = await prisma.commissionEntry.findMany({
    where: {
      salonId,
      periodKey,
      ...(staffId ? { staffId } : {}),
    },
    include: { staff: { select: { id: true, name: true } } },
  });

  const map = new Map<number, SummaryRow>();
  for (const entry of entries) {
    const key = entry.staffId;
    if (!map.has(key)) {
      map.set(key, {
        staffId: entry.staffId,
        staffName: entry.staff?.name || `Çalışan #${entry.staffId}`,
        periodKey,
        pendingTotal: 0,
        paidTotal: 0,
        cancelledTotal: 0,
        pendingCount: 0,
        serviceTotal: 0,
        bonusTotal: 0,
        manualTotal: 0,
        deductionTotal: 0,
      });
    }
    const row = map.get(key)!;
    if (entry.status === 'PENDING') {
      row.pendingTotal += entry.amount;
      row.pendingCount += 1;
    } else if (entry.status === 'PAID') {
      row.paidTotal += entry.amount;
    } else if (entry.status === 'CANCELLED') {
      row.cancelledTotal += entry.amount;
    }
    // Type bazlı agregasyon — UI'da pasta dilimi
    if (entry.type === 'SERVICE') row.serviceTotal += entry.amount;
    else if (entry.type === 'BONUS') row.bonusTotal += entry.amount;
    else if (entry.type === 'MANUAL_ADJUST') row.manualTotal += entry.amount;
    else if (entry.type === 'DEDUCTION') row.deductionTotal += entry.amount;
  }
  return Array.from(map.values()).sort((a, b) =>
    (b.pendingTotal + b.paidTotal) - (a.pendingTotal + a.paidTotal),
  );
}

/**
 * Bir staff×period için payout aç. Pending entry'leri PAID'e geçirir
 * ve payout kaydı oluşturur. Eğer bu staff×period için zaten payout
 * varsa hata fırlatır (idempotency).
 */
export async function createPayout(
  prisma: PrismaClient,
  params: {
    salonId: number;
    staffId: number;
    periodKey: string;
    paidByUserId?: number;
    paymentMethod?: string;
    notes?: string;
  },
): Promise<{ payoutId: number; totalAmount: number; entryCount: number }> {
  const { salonId, staffId, periodKey } = params;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.commissionPayout.findFirst({
      where: { salonId, staffId, periodKey },
    });
    if (existing) {
      throw new Error('PAYOUT_ALREADY_EXISTS');
    }

    const pendingEntries = await tx.commissionEntry.findMany({
      where: { salonId, staffId, periodKey, status: 'PENDING' },
    });
    if (pendingEntries.length === 0) {
      throw new Error('NO_PENDING_ENTRIES');
    }
    const totalAmount = pendingEntries.reduce((sum, e) => sum + e.amount, 0);

    const payout = await tx.commissionPayout.create({
      data: {
        salonId,
        staffId,
        periodKey,
        totalAmount,
        paidByUserId: params.paidByUserId ?? null,
        paymentMethod: params.paymentMethod ?? null,
        notes: params.notes ?? null,
      },
    });

    await tx.commissionEntry.updateMany({
      where: { id: { in: pendingEntries.map((e) => e.id) } },
      data: {
        status: 'PAID',
        payoutId: payout.id,
        paidAt: payout.paidAt,
        paidByUserId: params.paidByUserId ?? null,
      },
    });

    return { payoutId: payout.id, totalAmount, entryCount: pendingEntries.length };
  });
}

/**
 * Manuel entry ekle (bonus, kesinti, manuel düzeltme).
 * `type` SERVICE değil — SERVICE yalnızca otomatik appointment trigger'ı
 * ile oluşur. Kesinti için negatif amount kullan.
 */
export async function addManualEntry(
  prisma: PrismaClient,
  params: {
    salonId: number;
    staffId: number;
    periodKey: string;
    amount: number;
    type: Exclude<CommissionEntryType, 'SERVICE'>;
    notes?: string;
  },
): Promise<{ id: number }> {
  const entry = await prisma.commissionEntry.create({
    data: {
      salonId: params.salonId,
      staffId: params.staffId,
      periodKey: params.periodKey,
      baseAmount: 0,
      rate: null,
      fixedAmount: null,
      amount: params.amount,
      type: params.type,
      status: 'PENDING',
      notes: params.notes ?? null,
    },
  });
  return { id: entry.id };
}
