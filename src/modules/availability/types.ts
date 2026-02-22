// Core types for the new availability engine

export type PersonGroup = {
  personId: string;
  services: number[]; // Service IDs in UI order
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
  lockToken?: LockToken;
};

export type GroupSlots = {
  personId: string;
  slots: Slot[];
};

export type Slot = {
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  staffId: number;
  serviceSequence: ServiceSlot[];
};

export type ServiceSlot = {
  serviceId: number;
  start: string; // HH:mm
  end: string; // HH:mm
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
