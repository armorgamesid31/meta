import { DatesEngine, SlotsEngine } from '../modules/availability/index.js';
import type { AvailabilityRequest, DatesRequest, PersonGroup, SlotsResponse } from '../modules/availability/types.js';

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
        .map((service) => {
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

      return {
        personId,
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
  const engine = new SlotsEngine();
  return engine.generateSlots(request, options);
}

export async function generateAvailableDates(request: DatesRequest) {
  const engine = new DatesEngine();
  return engine.getAvailableDates(request);
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
