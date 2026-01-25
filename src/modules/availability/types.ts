type AvailabilitySlot = {
  startTime: Date;
  endTime: Date;
  availableStaff: number[];
  optionId: string;
};

type LockToken = {
  id: string;
  expiresAt: Date;
};

type AvailabilityOptions = {
  date: Date;
  serviceId: number;
  peopleCount: number;
  salonId: number;
};

type AvailabilityResult = {
  slots: AvailabilitySlot[];
  lockToken: LockToken;
};

// Legacy database record types (TEXT fields)
type LegacyAppointmentRecord = {
  id: string;
  calisan_id: string;
  tarih: string; // TEXT date like "2024-01-15"
  saat: string;   // TEXT time like "10:00"
  sure: string;   // TEXT duration like "60"
  durum: string;  // TEXT status
};

type LegacyLeaveRecord = {
  id: string;
  calisan_id: string;
  baslangic_tarihi: string; // TEXT date
  bitis_tarihi: string;     // TEXT date
  neden: string;
};

type LegacyLockRecord = {
  id: string;
  salon_id: string;
  tarih: string;
  saat: string;
  sure: string;
  expires_at: string; // TEXT datetime
  created_at: string;
};

module.exports = {
  AvailabilitySlot,
  LockToken,
  AvailabilityOptions,
  AvailabilityResult,
  LegacyAppointmentRecord,
  LegacyLeaveRecord,
  LegacyLockRecord
};
