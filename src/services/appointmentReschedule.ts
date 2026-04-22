import { randomUUID } from 'crypto';
import type { AppointmentSource } from '@prisma/client';
import { prisma } from '../prisma.js';
import { assertBookingAllowed } from './blacklist.js';

type PreferenceMode = 'ANY' | 'SPECIFIC';

type StaffCandidate = {
  staffId: number;
  name: string;
  title?: string | null;
  available: boolean;
  reason?: string;
};

type AppointmentBase = {
  id: number;
  salonId: number;
  customerId: number | null;
  customerName: string;
  customerPhone: string;
  startTime: Date;
  endTime: Date;
  status: string | null;
  source: string | null;
  notes: string | null;
  staffId: number;
  serviceId: number;
  gender: 'male' | 'female' | 'other';
  preferenceMode?: PreferenceMode | null;
  preferredStaffId?: number | null;
  rescheduledFromAppointmentId?: number | null;
  rescheduleBatchId?: string | null;
  service: {
    id: number;
    name: string;
    duration: number;
    price: number;
    requiresSpecialist?: boolean;
  };
  staff: {
    id: number;
    name: string;
    title?: string | null;
  };
  customer?: {
    id: number;
    name: string | null;
    phone: string;
  } | null;
};

export type ReschedulePreviewItem = {
  appointmentId: number;
  serviceId: number;
  serviceName: string;
  currentStartTime: string;
  currentEndTime: string;
  newStartTime: string;
  newEndTime: string;
  preferenceMode: PreferenceMode;
  preferredStaffId: number | null;
  selectedStaffId: number | null;
  needsManualChoice: boolean;
  candidates: StaffCandidate[];
  reason?: string;
};

export type ReschedulePreviewResult = {
  items: ReschedulePreviewItem[];
  requiresManualSelection: boolean;
  hasConflicts: boolean;
  conflicts: Array<{
    appointmentId: number;
    reason: string;
  }>;
};

export type RescheduleCommitResult = {
  batchId: string;
  previousAppointmentIds: number[];
  createdAppointments: AppointmentBase[];
};

export type ReschedulePreviewParams = {
  salonId: number;
  appointmentIds: number[];
  newStartTime: Date;
  assignments?: Record<number, number | null | undefined>;
};

export type RescheduleCommitParams = ReschedulePreviewParams & {
  idempotencyKey?: string | null;
};

type DbLike = typeof prisma;

function parseLegacyPreferenceFromNotes(notes: string | null | undefined, fallbackStaffId: number): {
  mode: PreferenceMode;
  preferredStaffId: number | null;
} {
  const text = String(notes || '');
  const specificMatch = text.match(/\[BOOK_PREF:SPECIFIC:(\d+)\]/i);
  if (specificMatch) {
    const parsed = Number(specificMatch[1]);
    if (Number.isInteger(parsed) && parsed > 0) {
      return { mode: 'SPECIFIC', preferredStaffId: parsed };
    }
  }
  if (/\[BOOK_PREF:ANY\]/i.test(text)) {
    return { mode: 'ANY', preferredStaffId: null };
  }
  return { mode: 'SPECIFIC', preferredStaffId: fallbackStaffId };
}

function uniquePositiveIds(values: unknown[]): number[] {
  const dedup = new Set<number>();
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric > 0) dedup.add(numeric);
  }
  return Array.from(dedup);
}

async function loadAppointments(db: DbLike, salonId: number, appointmentIds: number[]): Promise<AppointmentBase[]> {
  return db.appointment.findMany({
    where: {
      salonId,
      id: { in: appointmentIds },
    },
    include: {
      service: {
        select: {
          id: true,
          name: true,
          duration: true,
          price: true,
          requiresSpecialist: true,
        },
      },
      staff: {
        select: {
          id: true,
          name: true,
          title: true,
        },
      },
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
    },
    orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
  }) as Promise<AppointmentBase[]>;
}

function ensureBookedOnly(appointments: AppointmentBase[]): { ok: boolean; message?: string } {
  if (!appointments.length) {
    return { ok: false, message: 'Appointment not found.' };
  }
  for (const appointment of appointments) {
    const status = String(appointment.status || 'BOOKED').toUpperCase();
    if (status !== 'BOOKED' && status !== 'CONFIRMED') {
      return { ok: false, message: `Only BOOKED/CONFIRMED appointments can be rescheduled. #${appointment.id}` };
    }
  }
  return { ok: true };
}

function buildOffsets(appointments: AppointmentBase[], newBaseStart: Date): Array<{ appointment: AppointmentBase; startTime: Date; endTime: Date }> {
  const firstStartMs = appointments.length ? new Date(appointments[0].startTime).getTime() : newBaseStart.getTime();

  return appointments.map((appointment) => {
    const currentStartMs = new Date(appointment.startTime).getTime();
    const currentEndMs = new Date(appointment.endTime).getTime();
    const durationMs = Math.max(5 * 60 * 1000, currentEndMs - currentStartMs);
    const offsetMs = currentStartMs - firstStartMs;

    const startTime = new Date(newBaseStart.getTime() + offsetMs);
    const endTime = new Date(startTime.getTime() + durationMs);

    return { appointment, startTime, endTime };
  });
}

async function buildServiceStaffMap(db: DbLike, salonId: number, serviceIds: number[]): Promise<
  Record<number, Array<{ staffId: number; name: string; title?: string | null }>>
> {
  const rows = await db.staffService.findMany({
    where: {
      serviceId: { in: serviceIds },
      isactive: true,
      Staff: { salonId },
    },
    select: {
      serviceId: true,
      staffId: true,
      Staff: {
        select: {
          id: true,
          name: true,
          title: true,
        },
      },
    },
  });

  const map: Record<number, Array<{ staffId: number; name: string; title?: string | null }>> = {};
  for (const row of rows) {
    if (!map[row.serviceId]) {
      map[row.serviceId] = [];
    }
    if (!map[row.serviceId].some((item) => item.staffId === row.staffId)) {
      map[row.serviceId].push({
        staffId: row.staffId,
        name: row.Staff?.name || `Staff #${row.staffId}`,
        title: row.Staff?.title || null,
      });
    }
  }
  return map;
}

async function candidateAvailability(
  db: DbLike,
  salonId: number,
  chainIds: number[],
  staffId: number,
  startTime: Date,
  endTime: Date,
): Promise<boolean> {
  const overlap = await db.appointment.findFirst({
    where: {
      salonId,
      staffId,
      id: { notIn: chainIds },
      status: 'BOOKED',
      startTime: { lt: endTime },
      endTime: { gt: startTime },
    },
    select: { id: true },
  });

  return !overlap;
}

async function buildPreviewInternal(db: DbLike, params: ReschedulePreviewParams): Promise<ReschedulePreviewResult> {
  const appointmentIds = uniquePositiveIds(params.appointmentIds || []);
  if (!appointmentIds.length) {
    return {
      items: [],
      requiresManualSelection: false,
      hasConflicts: true,
      conflicts: [{ appointmentId: 0, reason: 'appointmentIds are required.' }],
    };
  }

  const appointments = await loadAppointments(db, params.salonId, appointmentIds);
  if (appointments.length !== appointmentIds.length) {
    return {
      items: [],
      requiresManualSelection: false,
      hasConflicts: true,
      conflicts: [{ appointmentId: 0, reason: 'One or more appointments were not found.' }],
    };
  }

  const bookedCheck = ensureBookedOnly(appointments);
  if (!bookedCheck.ok) {
    return {
      items: [],
      requiresManualSelection: false,
      hasConflicts: true,
      conflicts: [{ appointmentId: 0, reason: bookedCheck.message || 'Only BOOKED appointments can be rescheduled.' }],
    };
  }

  const chain = buildOffsets(appointments, params.newStartTime);
  const serviceStaffMap = await buildServiceStaffMap(
    db,
    params.salonId,
    uniquePositiveIds(appointments.map((item) => item.serviceId)),
  );

  const items: ReschedulePreviewItem[] = [];
  for (const entry of chain) {
    const appointment = entry.appointment;
    const legacyPref = parseLegacyPreferenceFromNotes(appointment.notes, appointment.staffId);
    const preferenceMode = (appointment.preferenceMode || legacyPref.mode || 'ANY') as PreferenceMode;
    const preferredStaffId =
      appointment.preferredStaffId !== null && appointment.preferredStaffId !== undefined
        ? appointment.preferredStaffId
        : legacyPref.preferredStaffId;

    const allowedStaff = serviceStaffMap[appointment.serviceId] || [];
    if (!allowedStaff.length) {
      items.push({
        appointmentId: appointment.id,
        serviceId: appointment.serviceId,
        serviceName: appointment.service.name,
        currentStartTime: appointment.startTime.toISOString(),
        currentEndTime: appointment.endTime.toISOString(),
        newStartTime: entry.startTime.toISOString(),
        newEndTime: entry.endTime.toISOString(),
        preferenceMode,
        preferredStaffId,
        selectedStaffId: null,
        needsManualChoice: false,
        candidates: [],
        reason: 'No active specialist found for this service.',
      });
      continue;
    }

    const assignment = params.assignments?.[appointment.id];
    const orderedCandidateIds: number[] = [];

    if (Number.isInteger(assignment) && Number(assignment) > 0) {
      const assigned = Number(assignment);
      if (allowedStaff.some((staff) => staff.staffId === assigned)) {
        orderedCandidateIds.push(assigned);
      }
    } else if (preferenceMode === 'SPECIFIC' && preferredStaffId && allowedStaff.some((staff) => staff.staffId === preferredStaffId)) {
      orderedCandidateIds.push(preferredStaffId);
    }

    for (const staff of allowedStaff) {
      if (!orderedCandidateIds.includes(staff.staffId)) {
        orderedCandidateIds.push(staff.staffId);
      }
    }

    const candidates: StaffCandidate[] = [];
    for (const candidateId of orderedCandidateIds) {
      const profile = allowedStaff.find((row) => row.staffId === candidateId);
      const available = await candidateAvailability(db, params.salonId, appointmentIds, candidateId, entry.startTime, entry.endTime);
      candidates.push({
        staffId: candidateId,
        name: profile?.name || `Staff #${candidateId}`,
        title: profile?.title || null,
        available,
        reason: available ? undefined : 'Busy at selected time.',
      });
    }

    const availableCandidates = candidates.filter((candidate) => candidate.available);

    let selectedStaffId: number | null = null;
    let needsManualChoice = false;
    let reason: string | undefined;

    if (Number.isInteger(assignment) && Number(assignment) > 0) {
      const assigned = Number(assignment);
      const assignedCandidate = candidates.find((candidate) => candidate.staffId === assigned);
      if (assignedCandidate?.available) {
        selectedStaffId = assigned;
      } else {
        reason = 'Selected specialist is not available at the new time.';
      }
    } else if (preferenceMode === 'SPECIFIC') {
      const preferredCandidate = preferredStaffId
        ? candidates.find((candidate) => candidate.staffId === preferredStaffId)
        : null;
      if (preferredCandidate?.available) {
        selectedStaffId = preferredCandidate.staffId;
      } else if (availableCandidates.length > 0) {
        needsManualChoice = true;
        reason = 'Preferred specialist is unavailable. Please select one of the available specialists.';
      } else {
        reason = 'No eligible specialist is available at the selected time.';
      }
    } else {
      selectedStaffId = availableCandidates.length ? availableCandidates[0].staffId : null;
      if (!selectedStaffId) {
        reason = 'No eligible specialist is available at the selected time.';
      }
    }

    items.push({
      appointmentId: appointment.id,
      serviceId: appointment.serviceId,
      serviceName: appointment.service.name,
      currentStartTime: appointment.startTime.toISOString(),
      currentEndTime: appointment.endTime.toISOString(),
      newStartTime: entry.startTime.toISOString(),
      newEndTime: entry.endTime.toISOString(),
      preferenceMode,
      preferredStaffId,
      selectedStaffId,
      needsManualChoice,
      candidates,
      reason,
    });
  }

  const conflicts = items
    .filter((item) => !item.selectedStaffId && !item.needsManualChoice)
    .map((item) => ({ appointmentId: item.appointmentId, reason: item.reason || 'No eligible specialist.' }));

  return {
    items,
    requiresManualSelection: items.some((item) => item.needsManualChoice),
    hasConflicts: conflicts.length > 0,
    conflicts,
  };
}

export async function buildAppointmentReschedulePreview(params: ReschedulePreviewParams): Promise<ReschedulePreviewResult> {
  return buildPreviewInternal(prisma as DbLike, params);
}

function appendNoteLine(previous: string | null | undefined, line: string): string {
  const base = String(previous || '').trim();
  if (!base) return line;
  return `${base}\n${line}`;
}

export async function commitAppointmentReschedule(params: RescheduleCommitParams): Promise<RescheduleCommitResult> {
  const appointmentIds = uniquePositiveIds(params.appointmentIds || []);
  if (!appointmentIds.length) {
    throw new Error('appointmentIds are required.');
  }

  return prisma.$transaction(async (tx) => {
    const batchId = (params.idempotencyKey || '').trim() || randomUUID();

    if (params.idempotencyKey) {
      const existingBatch = await tx.appointment.findMany({
        where: {
          salonId: params.salonId,
          rescheduleBatchId: batchId,
        },
        include: {
          service: {
            select: { id: true, name: true, duration: true, price: true, requiresSpecialist: true },
          },
          staff: {
            select: { id: true, name: true, title: true },
          },
          customer: {
            select: { id: true, name: true, phone: true },
          },
        },
        orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      }) as AppointmentBase[];

      if (existingBatch.length) {
        return {
          batchId,
          previousAppointmentIds: uniquePositiveIds(existingBatch.map((row) => row.rescheduledFromAppointmentId || 0)),
          createdAppointments: existingBatch,
        };
      }
    }

    const preview = await buildPreviewInternal(tx as unknown as DbLike, {
      salonId: params.salonId,
      appointmentIds,
      newStartTime: params.newStartTime,
      assignments: params.assignments,
    });

    if (preview.hasConflicts) {
      throw new Error(preview.conflicts[0]?.reason || 'No eligible specialist found for selected time.');
    }

    if (preview.requiresManualSelection) {
      throw new Error('Manual specialist selection is required before commit.');
    }

    const oldAppointments = await loadAppointments(tx as unknown as DbLike, params.salonId, appointmentIds);
    const oldById = new Map(oldAppointments.map((item) => [item.id, item]));

    for (const oldAppointment of oldAppointments) {
      await assertBookingAllowed({
        salonId: params.salonId,
        customerId: oldAppointment.customerId,
        phone: oldAppointment.customerPhone,
        channel: 'WHATSAPP',
      });
    }

    const createdAppointments: AppointmentBase[] = [];
    for (const item of preview.items) {
      const oldAppointment = oldById.get(item.appointmentId);
      if (!oldAppointment || !item.selectedStaffId) {
        throw new Error(`Cannot create rescheduled appointment for #${item.appointmentId}.`);
      }

      const forcedSpecificByAssignment = Number.isInteger(params.assignments?.[item.appointmentId] as number);
      const effectivePreferenceMode: PreferenceMode = forcedSpecificByAssignment
        ? 'SPECIFIC'
        : oldAppointment.preferenceMode || item.preferenceMode || 'ANY';
      const effectivePreferredStaffId =
        effectivePreferenceMode === 'SPECIFIC'
          ? item.selectedStaffId
          : null;
      const safeSource: AppointmentSource =
        oldAppointment.source === 'CUSTOMER'
          ? 'CUSTOMER'
          : oldAppointment.source === 'IMPORT'
            ? ('IMPORT' as AppointmentSource)
            : 'ADMIN';

      const created = (await tx.appointment.create({
        data: {
          salonId: oldAppointment.salonId,
          customerId: oldAppointment.customerId,
          customerName: oldAppointment.customerName,
          customerPhone: oldAppointment.customerPhone,
          startTime: new Date(item.newStartTime),
          endTime: new Date(item.newEndTime),
          status: 'BOOKED',
          source: safeSource,
          notes: appendNoteLine(oldAppointment.notes, `[RESCHEDULED_FROM:${oldAppointment.id}]`),
          staffId: item.selectedStaffId,
          serviceId: oldAppointment.serviceId,
          gender: oldAppointment.gender,
          preferenceMode: effectivePreferenceMode,
          preferredStaffId: effectivePreferredStaffId,
          rescheduledFromAppointmentId: oldAppointment.id,
          rescheduleBatchId: batchId,
        },
        include: {
          service: {
            select: {
              id: true,
              name: true,
              duration: true,
              price: true,
              requiresSpecialist: true,
            },
          },
          staff: {
            select: {
              id: true,
              name: true,
              title: true,
            },
          },
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
        },
      })) as unknown as AppointmentBase;

      createdAppointments.push(created);
    }

    for (const oldAppointment of oldAppointments) {
      await tx.appointment.update({
        where: { id: oldAppointment.id },
        data: {
          status: 'CANCELLED',
          notes: appendNoteLine(oldAppointment.notes, `[RESCHEDULED_TO_BATCH:${batchId}]`),
          rescheduleBatchId: batchId,
        },
      });
    }

    return {
      batchId,
      previousAppointmentIds: oldAppointments.map((item) => item.id),
      createdAppointments,
    };
  });
}
