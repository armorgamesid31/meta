import { prisma } from '../../prisma.js';
import {
  AvailabilityRequest,
  AppointmentRow,
  CategoryInfo,
  getGroupServiceIds,
  IndexedData,
  PersonGroup,
  ServiceInfo,
  SlotsResponse,
  StaffServiceRow,
  WorkingHoursRow,
} from './types.js';
import { AnchorIterator } from './anchor-iterator.js';
import { PermutationPruner } from './permutation-pruner.js';
import { ChainBuilder, ServiceChain } from './chain-builder.js';
import { MultiPersonAnchor } from './multi-person-anchor.js';
import { SlotScorer } from './slot-scorer.js';

export type GenerateSlotsOptions = {
  persistSearchContext?: boolean;
};

export class SlotsEngine {
  private anchorIterator = new AnchorIterator();
  private permutationPruner = new PermutationPruner();
  private chainBuilder = new ChainBuilder();
  private multiPersonAnchor = new MultiPersonAnchor(this);
  private slotScorer = new SlotScorer();

  // Statik 200 sınırı, çok-hizmet + çok-uzman senaryolarında valid alternatifleri
  // sessizce kesip atıyordu (audit [HIGH]). Sınırı dinamik hesaplıyoruz:
  // person sayısı × ortalama 50 alternatif. 6 person için 300, 1 person için 100.
  // Üst sınır 600 — sonsuz büyümeye karşı emniyet. Her durumda response'a
  // `hasMoreAlternatives` ile silent truncation'ı işaretle.
  private readonly MAX_COMBINATIONS_HARD_CAP = 600;
  private getMaxCombinations(request: AvailabilityRequest): number {
    const groupCount = Math.max(1, request.groups?.length || 1);
    const base = 100;
    const perPerson = 50;
    return Math.min(this.MAX_COMBINATIONS_HARD_CAP, base + perPerson * groupCount);
  }
  // Geri uyumluluk için: eski referanslar için sabit hesap edilen alanı tutuyoruz.
  private readonly MAX_COMBINATIONS = 200;

  async generateSlots(
    request: AvailabilityRequest,
    options: GenerateSlotsOptions = {},
  ): Promise<SlotsResponse> {
    const date = new Date(request.date);

    // Geçmiş gün ise erken çıkış — motor çalıştırmaya gerek yok.
    // Server TZ Europe/Istanbul'a pinned (bootstrap.ts) → local tarihler
    // salon-local güne karşılık gelir. dün ve öncesi için boş döner;
    // bugün için aşağıda saat filtresi ile şimdiki saatten önceki
    // slot'ları çıkarırız.
    const now = new Date();
    const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const requestLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    if (requestLocal < todayLocal) {
      return {
        date: request.date,
        groups: request.groups.map((g) => ({ personId: g.personId, slots: [] })),
        displaySlots: [],
      };
    }

    const data = await this.batchFetchData(request);

    const startSync = performance.now();
    const maxCombinationsForRequest = this.getMaxCombinations(request);
    const synchronized = await this.multiPersonAnchor.synchronizeGroups(
      request,
      date,
      data,
      maxCombinationsForRequest,
    );
    // Silent UX loss kalkanı: cap'e ulaştıysak daha fazla alternatif var
    // olabilir, frontend bunu kullanıcıya bildirebilir ("Daha fazla saat
    // için tarihi daralt" tarzı).
    const hitCombinationCap = synchronized.length >= maxCombinationsForRequest;

    const optimized = this.slotScorer.optimize(
      synchronized,
      request.groups.map((group) => group.personId),
    );

    // Bugün için: now'dan önceki slot başlangıçlarını ele. Salon
    // hâlâ 09:00-18:00 açık olsa bile saat 14:00'da müşteriye
    // 09:00 slotu önermenin anlamı yok.
    if (requestLocal === todayLocal) {
      const minStartMinutes = now.getHours() * 60 + now.getMinutes();
      const parseHHMM = (value: string): number => {
        const [h, m] = value.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
      };
      optimized.displaySlots = optimized.displaySlots.filter(
        (ds) => parseHHMM(ds.startTime) >= minStartMinutes,
      );
      optimized.groups = optimized.groups.map((g) => ({
        ...g,
        slots: g.slots.filter((s) => parseHHMM(s.startTime) >= minStartMinutes),
      }));
    }

    const endSync = performance.now();
    const executionTime = endSync - startSync;

    if (executionTime > 1000 || hitCombinationCap) {
      console.warn('AVAILABILITY_METRICS', {
        duration: executionTime,
        salonId: request.salonId,
        date: request.date,
        groupCount: request.groups.length,
        combinationsReturned: synchronized.length,
        maxCombinations: maxCombinationsForRequest,
        hitCap: hitCombinationCap,
      });
    }

    if (options.persistSearchContext === false) {
      return {
        date: request.date,
        groups: optimized.groups,
        displaySlots: optimized.displaySlots,
        hasMoreAlternatives: hitCombinationCap,
      };
    }

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const searchContext = await prisma.searchContext.create({
      data: {
        salonId: request.salonId,
        data: request as any,
        expiresAt,
      },
    });

    return {
      date: request.date,
      groups: optimized.groups,
      displaySlots: optimized.displaySlots,
      lockToken: {
        id: searchContext.id,
        expiresAt,
      },
      hasMoreAlternatives: hitCombinationCap,
    };
  }

  async generateSlotsForGroup(
    group: PersonGroup,
    date: Date,
    data: IndexedData,
  ): Promise<ServiceChain[]> {
    const validChains: ServiceChain[] = [];

    const permutationsGen = this.permutationPruner.generateValidPermutations(
      getGroupServiceIds(group),
      data,
      group.gender,
    );

    const anchorsGen = this.anchorIterator.iterateAnchors(
      {
        salonId: 0,
        date: date.toISOString().split('T')[0],
        groups: [group],
      },
      date,
      data,
    );

    const anchors = [] as Array<{ hour: number; staffId: number }>;
    for await (const anchor of anchorsGen) {
      anchors.push(anchor);
    }

    for await (const permutation of permutationsGen) {
      for (const anchor of anchors) {
        const chain = await this.chainBuilder.buildChain(
          permutation,
          anchor,
          1,
          data,
          date,
          group,
        );

        if (chain) {
          validChains.push(chain);
        }
      }
    }

    return validChains;
  }

  private async batchFetchData(request: AvailabilityRequest): Promise<IndexedData> {
    const serviceIds = [...new Set(request.groups.flatMap((group) => getGroupServiceIds(group)))];
    const date = new Date(request.date);
    // Server TZ Europe/Istanbul'a pinned (bootstrap.ts). setHours(0,0,0,0)
    // local midnight'i verir → Istanbul 00:00 = UTC 21:00 önceki gün.
    // Tek-TZ topolojide doğru. AUDIT NOT: çoklu-salon TZ desteği gelirse
    // burada salonSettings.timezone'a göre tz-aware midnight üretmemiz
    // gerekir (Intl.DateTimeFormat veya date-fns-tz ile). Bayram/tatil
    // günlerinin bir saatlik yanlış kayması o yapıda mümkün.
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const [staffServices, appointments, services, serviceVariants, categories, salonSettings] = await Promise.all([
      prisma.staffService.findMany({
        where: {
          serviceId: { in: serviceIds },
          Staff: { salonId: request.salonId },
          isactive: true,
        },
        select: {
          staffId: true,
          serviceId: true,
          duration: true,
          isactive: true,
        },
      }),

      prisma.appointment.findMany({
        where: {
          salonId: request.salonId,
          startTime: { gte: startOfDay, lte: endOfDay },
          status: { in: ['BOOKED', 'COMPLETED'] },
        },
        select: {
          id: true,
          staffId: true,
          serviceId: true,
          startTime: true,
          endTime: true,
          status: true,
        },
      }),

      prisma.service.findMany({
        where: { id: { in: serviceIds } },
        select: {
          id: true,
          name: true,
          duration: true,
          bufferOverride: true,
          categoryId: true,
          capacityOverride: true,
        },
      }),

      // ServiceVariant rows for the requested services. We only fetch
      // active rows — inactive variants behave like a missing row, so
      // the engine falls back to Service.duration for that gender.
      prisma.serviceVariant.findMany({
        where: { serviceId: { in: serviceIds }, isActive: true },
        select: {
          id: true,
          serviceId: true,
          gender: true,
          price: true,
          duration: true,
        },
      }),

      prisma.serviceCategory.findMany({
        where: {
          salonId: request.salonId,
        },
        select: {
          id: true,
          sequentialRequired: true,
          bufferMinutes: true,
          capacity: true,
        },
      }),

      prisma.salonSettings.findUnique({
        where: { salonId: request.salonId },
        select: {
          workStartHour: true,
          workEndHour: true,
          // Salon kapalı günleri (örn. ["MON","TUE",…,"SAT"] = Pazar
          // kapalı). Fallback working hours koyarken o gün listede
          // değilse staff için hiç working hour kaydı yazmayız —
          // motor o günü "yok" sayar, slot dönmez.
          workingDays: true,
          // Gün-bazlı saat override'ı (varsa o günün düz saati yerine geçer).
          workingHoursByDay: true,
        },
      }),
    ]);

    const relevantStaffIds = [...new Set(staffServices.map((row) => row.staffId))];

    const [workingHours, salonClosures, staffTimeOffs, legacyLeaves, slotLocks, staffSchedules] = await Promise.all([
      prisma.staffWorkingHours.findMany({
        where: {
          staffId: { in: relevantStaffIds },
          dayOfWeek: date.getDay(),
        },
        select: {
          staffId: true,
          dayOfWeek: true,
          startHour: true,
          endHour: true,
        },
      }),
      prisma.salonClosure.findMany({
        where: {
          salonId: request.salonId,
          startAt: { lte: endOfDay },
          endAt: { gte: startOfDay },
        },
        select: {
          id: true,
          startAt: true,
          endAt: true,
        },
      }),
      prisma.staffTimeOff.findMany({
        where: {
          salonId: request.salonId,
          staffId: { in: relevantStaffIds },
          startAt: { lte: endOfDay },
          endAt: { gte: startOfDay },
        },
        select: {
          id: true,
          staffId: true,
          startAt: true,
          endAt: true,
        },
      }),
      prisma.leave.findMany({
        where: {
          staffId: { in: relevantStaffIds },
          startDate: { lte: endOfDay },
          endDate: { gte: startOfDay },
        },
        select: {
          id: true,
          staffId: true,
        },
      }),
      // Active SlotLock'lar — 120sn'lik kullanıcı rezervasyonu. BOOKED
      // randevular gibi blockedAppointment olarak ele alınır; başka
      // müşteri o staff×saat'i boş göremez. Booking commit re-validation
      // yaparken request.ignoreLockId verilirse kullanıcının kendi
      // lock'unu hariç tutarız (aksi takdirde kendi rezervasyonu kendi
      // slot'unu kapatır).
      prisma.slotLock.findMany({
        where: {
          salonId: request.salonId,
          expiresAt: { gt: new Date() },
          ...(request.ignoreLockId ? { id: { not: request.ignoreLockId } } : {}),
        },
        select: { entries: true },
      }),
      // Hangi personelin GÜN-BAZLI özel takvimi var (herhangi bir günde)? Set
      // BOŞSA (kimse özel saat girmemişse) davranış AYNEN korunur (sıfır regresyon).
      // Doluysa: özel takvimli personelin o güne kaydı yoksa motor onu KAPALI sayar
      // (salon fallback'ine düşmez) — "Zeynep cumartesi çalışmaz" ifade edilebilsin.
      prisma.staffWorkingHours.findMany({
        where: { staffId: { in: relevantStaffIds } },
        select: { staffId: true },
        distinct: ['staffId'],
      }),
    ]);

    const indexedData: IndexedData = {
      staffServicesByService: new Map<number, StaffServiceRow[]>(),
      workingHoursByStaffAndDay: new Map<string, WorkingHoursRow>(),
      appointmentsByStaffAndDate: new Map<string, AppointmentRow[]>(),
      servicesById: new Map<number, ServiceInfo>(),
      categoriesById: new Map<number, CategoryInfo>(),
      serviceVariantsByServiceAndGender: new Map(),
    };

    for (const variant of serviceVariants) {
      const key = `${variant.serviceId}:${variant.gender}`;
      indexedData.serviceVariantsByServiceAndGender.set(key, {
        id: variant.id,
        serviceId: variant.serviceId,
        gender: String(variant.gender),
        price: variant.price,
        duration: variant.duration,
      });
    }

    for (const staffService of staffServices) {
      if (!indexedData.staffServicesByService.has(staffService.serviceId)) {
        indexedData.staffServicesByService.set(staffService.serviceId, []);
      }
      indexedData.staffServicesByService.get(staffService.serviceId)!.push(staffService as StaffServiceRow);
    }

    const dayOfWeek = date.getDay();
    for (const workingHour of workingHours) {
      if (workingHour.dayOfWeek !== null) {
        const key = `${workingHour.staffId}-${workingHour.dayOfWeek}`;
        indexedData.workingHoursByStaffAndDay.set(key, workingHour as WorkingHoursRow);
      }
    }

    if (salonSettings) {
      // workingDays: salon hangi günler açık ("MON","TUE",… "SUN").
      // Tanımlıysa o gün listede yoksa fallback YAPMA — staff için
      // working hour kaydı yazmazsak motor o günü kapalı sayar.
      // workingDays null/boş → kontrol atla (legacy default davranış).
      const DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
      const todayKey = DAY_KEYS[dayOfWeek];
      const rawWorkingDays = salonSettings.workingDays;
      const workingDays = Array.isArray(rawWorkingDays)
        ? (rawWorkingDays as unknown[])
            .map((d) => String(d).toUpperCase().trim())
            .filter((d) => DAY_KEYS.includes(d as typeof DAY_KEYS[number]))
        : null;
      const salonOpenToday = workingDays === null || workingDays.includes(todayKey);

      // Gün-bazlı saat override'ı: bu gün için kayıt varsa düz saat yerine onu kullan
      // (ör. Cumartesi 09–13). Personelin kendi StaffWorkingHours kaydı varsa o yine
      // önceliklidir (yukarıda set edildi); fallback yalnızca kaydı olmayan personel için.
      const perDay = (salonSettings.workingHoursByDay as Record<string, { start?: number; end?: number }> | null)?.[
        todayKey
      ];
      const fallbackStart = typeof perDay?.start === 'number' ? perDay.start : salonSettings.workStartHour;
      const fallbackEnd = typeof perDay?.end === 'number' ? perDay.end : salonSettings.workEndHour;

      if (salonOpenToday) {
        // Gün-bazlı özel takvimi olan personeller. Boşsa (kimse girmemişse) eski
        // davranış: tüm personel salon saatine düşer (sıfır regresyon).
        const staffWithSchedule = new Set(staffSchedules.map((s) => s.staffId));
        for (const staffId of relevantStaffIds) {
          const key = `${staffId}-${dayOfWeek}`;
          if (indexedData.workingHoursByStaffAndDay.has(key)) continue; // bugüne kaydı var → kullan
          // Özel takvimli ama bugün kaydı YOK → bu personel bugün KAPALI (fallback YAPMA).
          if (staffWithSchedule.has(staffId)) continue;
          // Hiç özel takvimi olmayan personel → salon (gün-bazlı) saatine düş.
          indexedData.workingHoursByStaffAndDay.set(key, {
            staffId,
            dayOfWeek,
            startHour: fallbackStart,
            endHour: fallbackEnd,
          });
        }
      }
    }

    const blockedAppointments: AppointmentRow[] = [];
    for (const closure of salonClosures) {
      for (const staffId of relevantStaffIds) {
        blockedAppointments.push({
          id: -1_000_000_000 - closure.id,
          staffId,
          serviceId: 0,
          startTime: closure.startAt,
          endTime: closure.endAt,
          status: 'BLOCKED',
        });
      }
    }

    for (const timeOff of staffTimeOffs) {
      blockedAppointments.push({
        id: -2_000_000_000 - timeOff.id,
        staffId: timeOff.staffId,
        serviceId: 0,
        startTime: timeOff.startAt,
        endTime: timeOff.endAt,
        status: 'BLOCKED',
      });
    }

    for (const legacyLeave of legacyLeaves) {
      blockedAppointments.push({
        id: -3_000_000_000 - legacyLeave.id,
        staffId: legacyLeave.staffId,
        serviceId: 0,
        startTime: startOfDay,
        endTime: endOfDay,
        status: 'BLOCKED',
      });
    }

    let lockEntryIndex = 0;
    for (const lock of slotLocks) {
      const lockEntries = Array.isArray(lock.entries) ? (lock.entries as Array<Record<string, unknown>>) : [];
      for (const entry of lockEntries) {
        const staffId = Number(entry?.staffId);
        const lockStart = new Date(String(entry?.startTime || ''));
        const lockEnd = new Date(String(entry?.endTime || ''));
        if (!Number.isInteger(staffId) || staffId <= 0) continue;
        if (Number.isNaN(lockStart.getTime()) || Number.isNaN(lockEnd.getTime())) continue;
        // Sadece bugünü etkileyen lock'lar.
        if (lockEnd <= startOfDay || lockStart >= endOfDay) continue;
        blockedAppointments.push({
          id: -4_000_000_000 - lockEntryIndex,
          staffId,
          serviceId: 0,
          startTime: lockStart,
          endTime: lockEnd,
          status: 'LOCKED',
        });
        lockEntryIndex += 1;
      }
    }

    for (const appointment of [...appointments, ...blockedAppointments]) {
      const dateKey = appointment.startTime.toISOString().split('T')[0];
      const key = `${appointment.staffId}-${dateKey}`;
      if (!indexedData.appointmentsByStaffAndDate.has(key)) {
        indexedData.appointmentsByStaffAndDate.set(key, []);
      }
      indexedData.appointmentsByStaffAndDate.get(key)!.push(appointment as unknown as AppointmentRow);
    }

    for (const service of services) {
      indexedData.servicesById.set(service.id, service);
    }

    for (const category of categories) {
      indexedData.categoriesById.set(category.id, {
        id: category.id,
        sequentialRequired: category.sequentialRequired ?? false,
        bufferMinutes: category.bufferMinutes,
        capacity: category.capacity ?? 1,
      });
    }

    return indexedData;
  }
}
