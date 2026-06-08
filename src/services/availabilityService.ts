import { DatesEngine, SlotsEngine } from '../modules/availability/index.js';
import type { AvailabilityRequest, DatesRequest, PersonGroup, SlotsResponse } from '../modules/availability/types.js';
import type { DatesResponse } from '../modules/availability/types.js';
import {
  availabilityDatesCacheKey,
  availabilitySlotsCacheKey,
  getCachedAvailability,
  setCachedAvailability,
} from './availabilityCache.js';

export type SelectedPersonSlotInput = {
  personId: string;
  slotKey: string;
};

export type AvailabilityAlternatives = {
  date: string | null;
  availableDates: string[];
  displaySlots: SlotsResponse['displaySlots'];
  lockToken: SlotsResponse['lockToken'] | null;
};

export function normalizePersonGroups(input: unknown): PersonGroup[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((group, index) => {
      const servicesInput = Array.isArray((group as any)?.services) ? (group as any).services : [];
      const services = servicesInput
        .map((service: any) => {
          if (typeof service === 'number' || typeof service === 'string') {
            const serviceId = Number(service);
            return Number.isInteger(serviceId) && serviceId > 0 ? serviceId : null;
          }

          const serviceId = Number((service as any)?.serviceId);
          if (!Number.isInteger(serviceId) || serviceId <= 0) {
            return null;
          }

          const allowedStaffIds = Array.isArray((service as any)?.allowedStaffIds)
            ? (service as any).allowedStaffIds
                .map((value: unknown) => Number(value))
                .filter((value: number, idx: number, list: number[]) => Number.isInteger(value) && value > 0 && list.indexOf(value) === idx)
            : [];

          return {
            serviceId,
            allowedStaffIds: allowedStaffIds.length ? allowedStaffIds : null,
          };
        })
        .filter(Boolean);

      if (!services.length) {
        return null;
      }

      const personId = typeof (group as any)?.personId === 'string' && (group as any).personId.trim()
        ? (group as any).personId.trim()
        : `p${index + 1}`;

      // Tolerant gender parse — accepts FEMALE/MALE/OTHER, female/male/other,
      // and Turkish kadin/erkek so callers from web v2 and admin clients
      // converge on the engine's lowercase enum without forcing the wire
      // contract to know which side normalises.
      const rawGender = String((group as any)?.gender || '').trim().toLowerCase();
      const gender = (() => {
        if (rawGender === 'female' || rawGender === 'kadin') return 'female' as const;
        if (rawGender === 'male' || rawGender === 'erkek') return 'male' as const;
        if (rawGender === 'other' || rawGender === 'belirtmek-istemiyorum') return 'other' as const;
        return undefined;
      })();

      return {
        personId,
        ...(gender ? { gender } : {}),
        services,
      } satisfies PersonGroup;
    })
    .filter((group): group is PersonGroup => Boolean(group));
}

export function buildSingleServiceGroups(serviceId: number, peopleCount = 1): PersonGroup[] {
  return Array.from({ length: Math.max(1, peopleCount) }, (_, index) => ({
    personId: `p${index + 1}`,
    services: [serviceId],
  }));
}

export async function generateAvailability(
  request: AvailabilityRequest,
  options: { persistSearchContext?: boolean } = {},
): Promise<SlotsResponse> {
  // Cache yalnızca persistSearchContext === false durumunda devreye girer:
  //  - persistSearchContext === true (varsayılan) DB'ye lock token yazar;
  //    cache'lenmiş sonuç döndürürsek farklı arama için aynı token
  //    paylaşılır → güvenlik riski.
  //  - persistSearchContext === false (booking commit re-validation,
  //    dates-engine inner loop, alternatives) saf okuma → cache güvenli.
  //  - ignoreLockId varsa (booking commit) cache atla — kullanıcının
  //    kendi lock'unu hariç tutmak isteyen taze sorgu lazım.
  const canCache = options.persistSearchContext === false && !request.ignoreLockId;
  if (canCache) {
    const cacheKey = availabilitySlotsCacheKey({
      salonId: request.salonId,
      date: request.date,
      groups: request.groups,
    });
    const cached = await getCachedAvailability<SlotsResponse>(cacheKey);
    if (cached) return cached;

    const engine = new SlotsEngine();
    const result = await engine.generateSlots(request, options);
    await setCachedAvailability(cacheKey, result);
    return result;
  }

  const engine = new SlotsEngine();
  return engine.generateSlots(request, options);
}

export async function generateAvailableDates(request: DatesRequest): Promise<DatesResponse> {
  const cacheKey = availabilityDatesCacheKey({
    salonId: request.salonId,
    startDate: request.startDate,
    endDate: request.endDate,
    groups: request.groups,
  });
  const cached = await getCachedAvailability<DatesResponse>(cacheKey);
  if (cached) return cached;

  const engine = new DatesEngine();
  const result = await engine.getAvailableDates(request);
  await setCachedAvailability(cacheKey, result);
  return result;
}

export function parseSelectedPersonSlots(input: unknown): SelectedPersonSlotInput[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((row) => {
      const personId = typeof (row as any)?.personId === 'string' ? (row as any).personId.trim() : '';
      const slotKey = typeof (row as any)?.slotKey === 'string' ? (row as any).slotKey.trim() : '';
      if (!personId || !slotKey) return null;
      return { personId, slotKey };
    })
    .filter((row): row is SelectedPersonSlotInput => Boolean(row));
}

export function matchSelectedDisplaySlots(
  response: SlotsResponse,
  selectedSlots: SelectedPersonSlotInput[],
): SlotsResponse['displaySlots'][number] | null {
  if (!selectedSlots.length) return null;

  return (
    response.displaySlots.find((displaySlot) =>
      selectedSlots.every((selectedSlot) =>
        displaySlot.personSlots.some(
          (personSlot) =>
            personSlot.personId === selectedSlot.personId &&
            personSlot.slotKey === selectedSlot.slotKey,
        ),
      ),
    ) || null
  );
}

export async function generateAvailabilityAlternatives(input: {
  salonId: number;
  request: AvailabilityRequest;
  preferredDate: string;
  horizonDays?: number;
}): Promise<AvailabilityAlternatives> {
  const sameDay = await generateAvailability(input.request);
  if (sameDay.displaySlots.length > 0) {
    return {
      date: input.preferredDate,
      availableDates: [input.preferredDate],
      displaySlots: sameDay.displaySlots,
      lockToken: sameDay.lockToken || null,
    };
  }

  const startDate = new Date(`${input.preferredDate}T00:00:00`);
  startDate.setDate(startDate.getDate() + 1);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + Math.max(1, input.horizonDays || 30) - 1);

  const dates = await generateAvailableDates({
    salonId: input.salonId,
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    groups: input.request.groups,
  });

  const nextDate = dates.availableDates[0] || null;
  if (!nextDate) {
    return {
      date: null,
      availableDates: [],
      displaySlots: [],
      lockToken: null,
    };
  }

  const nextSlots = await generateAvailability({
    ...input.request,
    date: nextDate,
  });

  return {
    date: nextDate,
    availableDates: dates.availableDates,
    displaySlots: nextSlots.displaySlots,
    lockToken: nextSlots.lockToken || null,
  };
}
