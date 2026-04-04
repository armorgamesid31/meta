// Core types for the new availability engine

export type GroupServiceSelection = {
  serviceId: number;
  allowedStaffIds: number[] | null;
};

export type PersonGroup = {
  personId: string;
  services: Array<number | GroupServiceSelection>; // Service IDs in UI order
};

export type AvailabilityRequest = {
  salonId: number;
  date: string; // YYYY-MM-DD
  groups: PersonGroup[];
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
};

export type SlotsResponse = {
  date: string;
  groups: GroupSlots[];
  displaySlots: DisplaySlot[];
  lockToken?: LockToken;
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
};

export type StaffServiceRow = {
  staffId: number;
  serviceId: number;
  duration: number;
  isactive: boolean;
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

export function getAllowedStaffIdsForService(group: PersonGroup, serviceId: number): number[] | null {
  const matching = getGroupServiceSelections(group)
    .filter((selection) => selection.serviceId === serviceId)
    .flatMap((selection) => selection.allowedStaffIds || []);

  if (!matching.length) return null;
  return Array.from(new Set(matching));
}
