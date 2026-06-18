// Core types for the new availability engine

export type GroupServiceSelection = {
  serviceId: number;
  allowedStaffIds: number[] | null;
};

export type PersonGroup = {
  personId: string;
  // Optional gender hint used to pick a ServiceVariant (per-gender
  // price/duration override). Undefined = engine falls back to the
  // Service.duration base value for every selected service. When set,
  // we look up `ServiceVariant{ serviceId, gender }` and use its
  // duration if a row exists & isActive.
  gender?: 'female' | 'male' | 'other';
  services: Array<number | GroupServiceSelection>; // Service IDs in UI order
};

export type AvailabilityRequest = {
  salonId: number;
  date: string; // YYYY-MM-DD
  groups: PersonGroup[];
  /**
   * Booking commit'te re-validation yaparken motor müşterinin kendi
   * rezerve ettiği SlotLock'u "dolu" saymamalı — aksi takdirde kendi
   * lock'u kendi slot'unu engeller. Set edilirse batchFetchData o
   * lock'u çekmez.
   */
  ignoreLockId?: string;
};

export type DatesRequest = {
  salonId: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  groups: PersonGroup[];
};

export type DatesResponse = {
  availableDates: string[];
  unavailableDates: string[];
  /**
   * Salon o gün için kapalı (SalonSettings.workingDays listesinde
   * dayOfWeek yok). UI bu günleri "Kapalı" diye etiketleyebilir,
   * "Dolu" demek yanlış olur (zaten hiç açılmamış).
   */
  closedDates: string[];
};

export type SlotsResponse = {
  date: string;
  groups: GroupSlots[];
  displaySlots: DisplaySlot[];
  lockToken?: LockToken;
  /**
   * Engine MAX_COMBINATIONS sınırına ulaştı; daha fazla valid alternatif
   * olabilir ama sessizce kesildi. Frontend kullanıcıya bildirebilir:
   * "Daha fazla saat için tarihi daralt".
   */
  hasMoreAlternatives?: boolean;
  /**
   * O gün salonun açık olduğu saat penceresi (tüm personelin working hours
   * birleşimi: en erken başlangıç, en geç bitiş — saat tam sayısı). Frontend
   * bunu kullanarak tam zaman ızgarasını kurar ve hiç slot dönmeyen saatleri
   * "müsait değil" (silik gri) gösterir. Salon o gün kapalıysa undefined.
   */
  workingWindow?: { startHour: number; endHour: number };
};

export type GroupSlots = {
  personId: string;
  slots: Slot[];
};

export type Slot = {
  slotKey: string;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  staffId: number;
  serviceSequence: ServiceSlot[];
};

export type ServiceSlot = {
  serviceId: number;
  start: string; // HH:mm
  end: string; // HH:mm
  staffId: number;
};

export type DisplayPersonSlot = {
  personId: string;
  slotKey: string;
  startTime: string;
  endTime: string;
  staffId: number;
  serviceSequence: ServiceSlot[];
};

export type DisplaySlot = {
  displayKey: string;
  label: string;
  startTime: string;
  endTime: string;
  personSlots: DisplayPersonSlot[];
  /** OFF_PEAK kampanyası varsa slot bu aralığa giriyordur: "Sakin saat – %10 indirim" gibi. */
  offPeakLabel?: string;
  /**
   * Müşteri uzman tercihi yaptıysa (preferredStaffIds): bu slot tercih edilen
   * uzman(lar)la mı dolduruluyor? true = istediği gibi (UI yeşil), false =
   * müsait ama BAŞKA uzmanla (UI mavi + onay sorar). Tercih yoksa hepsi true.
   * Route seviyesinde set edilir (motor algoritması değişmez).
   */
  matchesPreferred?: boolean;
};

export type LockToken = {
  id: string;
  expiresAt: Date;
};

// Internal types for chain building
export type ChainBlock = {
  type: 'sequential' | 'individual';
  services: ServiceInfo[];
  categoryId: number | null;
};

export type ServiceInfo = {
  id: number;
  name: string;
  duration: number;
  bufferOverride: number | null;
  categoryId: number | null;
  capacityOverride: number | null;
  // When a ServiceVariant override was applied during permutation
  // build, we remember its id here so the booking commit can snapshot
  // it onto AppointmentLine.serviceVariantId. Undefined = no variant
  // was applied (the engine ran with the base Service.duration).
  serviceVariantId?: number;
};

export type CategoryInfo = {
  id: number;
  sequentialRequired: boolean;
  bufferMinutes: number | null;
  capacity: number;
};

// Indexed data structures for fast lookups
export type IndexedData = {
  staffServicesByService: Map<number, StaffServiceRow[]>;
  workingHoursByStaffAndDay: Map<string, WorkingHoursRow>;
  appointmentsByStaffAndDate: Map<string, AppointmentRow[]>;
  servicesById: Map<number, ServiceInfo>;
  categoriesById: Map<number, CategoryInfo>;
  // Per-gender service overrides, keyed by `${serviceId}:${gender}`.
  // Lookup is a hot path (every chain step), so we pre-flatten the rows
  // into a Map here instead of scanning at evaluation time. Inactive
  // variants are filtered out at fetch time — caller treats a miss as
  // "fall back to Service.duration".
  serviceVariantsByServiceAndGender: Map<string, ServiceVariantInfo>;
};

export type ServiceVariantInfo = {
  id: number;
  serviceId: number;
  gender: string;
  price: number;
  duration: number;
};

export type StaffServiceRow = {
  staffId: number;
  serviceId: number;
  duration: number;
  isactive: boolean;
  // Müşteri cinsiyetine göre per-staff süre (ve fiyat) ayrımı. Süre seçiminde
  // (chain-builder.calculateServiceDurations) staff×gender eşleşmesi için.
  gender?: string;
};

export type WorkingHoursRow = {
  staffId: number;
  dayOfWeek: number;
  startHour: number;
  endHour: number;
};

export type AppointmentRow = {
  id: number;
  staffId: number;
  serviceId: number;
  startTime: Date;
  endTime: Date;
  status: string;
};

export type AvailabilitySlot = {
  startTime: Date;
  endTime: Date;
  availableStaff: number[];
  optionId: string;
};

export type AvailabilityOptions = {
  date: Date;
  serviceId: number;
  peopleCount: number;
  salonId: number;
};

export type AvailabilityResult = {
  slots: AvailabilitySlot[];
  lockToken: LockToken;
};

export type LegacyAppointmentRecord = {
  id: string;
  calisan_id: string;
  tarih: string;
  saat: string;
  sure: string;
  durum: string;
};

export type LegacyLeaveRecord = {
  id: string;
  calisan_id: string;
  baslangic_tarihi: string;
  bitis_tarihi: string;
  neden: string;
};

export type LegacyLockRecord = {
  id: string;
  salon_id: string;
  tarih: string;
  saat: string;
  sure: string;
  expires_at: string;
  created_at: string;
};

export function getGroupServiceSelections(group: PersonGroup): GroupServiceSelection[] {
  return (group.services || [])
    .map((selection) => {
      if (typeof selection === 'number') {
        return { serviceId: selection, allowedStaffIds: null };
      }

      if (!selection || !Number.isInteger(Number(selection.serviceId))) {
        return null;
      }

      const allowedStaffIds = Array.isArray(selection.allowedStaffIds)
        ? selection.allowedStaffIds
            .map((value) => Number(value))
            .filter((value, index, list) => Number.isInteger(value) && value > 0 && list.indexOf(value) === index)
        : null;

      return {
        serviceId: Number(selection.serviceId),
        allowedStaffIds: allowedStaffIds && allowedStaffIds.length ? allowedStaffIds : null,
      };
    })
    .filter((selection): selection is GroupServiceSelection => Boolean(selection));
}

export function getGroupServiceIds(group: PersonGroup): number[] {
  return getGroupServiceSelections(group).map((selection) => selection.serviceId);
}

/**
 * Randevu/lock'ları gün bazında indekslerken ve sorgularken kullanılan
 * anahtar — YEREL (server TZ = Europe/Istanbul) tarih bileşenleriyle.
 *
 * Neden toISOString() DEĞİL: ISO UTC tarihi verir. Istanbul 00:00–02:59
 * arası başlayan bir randevu UTC'de bir önceki güne düşer; indeksleme UTC,
 * çakışma hesabı ise yerel saat (getHours) kullandığından randevu yanlış
 * güne indekslenip o günün çakışma kontrolünden kaçabilirdi (slot yanlışlıkla
 * "boş" görünürdü). İndeksleme ve lookup'ın İKİSİ de bu yerel anahtarı
 * kullanmalı ki cross-midnight randevular doğru güne otursun.
 */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getAllowedStaffIdsForService(group: PersonGroup, serviceId: number): number[] | null {
  const matching = getGroupServiceSelections(group)
    .filter((selection) => selection.serviceId === serviceId)
    .flatMap((selection) => selection.allowedStaffIds || []);

  if (!matching.length) return null;
  return Array.from(new Set(matching));
}
