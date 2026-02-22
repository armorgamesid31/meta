import { v4 as uuidv4 } from 'uuid';
import {
  AvailabilitySlot,
  AvailabilityOptions,
  AvailabilityResult,
  LockToken
} from './types.js';
import type { ServiceWithCategory } from '../../utils/durationCalculator.js';
import { prisma } from '../../prisma.js';

type ConstraintAppointment = {
  id: number;
  staffId: number;
  startTime: Date;
  endTime: Date;
};

type ConstraintLeave = {
  id: number;
  staffId: number;
  startDate: Date;
  endDate: Date;
};

type ConstraintLock = {
  id: string;
  startTime: Date;
  endTime: Date;
  expiresAt: Date;
};

class AvailabilityEngine {
  /**
   * Calculate available time slots for a given date and service
   */
  async calculateAvailability(options: AvailabilityOptions): Promise<AvailabilityResult> {
    const { date, serviceId, peopleCount, salonId } = options;

    const staffServices = await this.getStaffForService(serviceId, salonId);
    if (staffServices.length === 0) {
      return { slots: [], lockToken: this.generateLockToken() };
    }

    const dayOfWeek = date.getDay();
    const salonSettings = await prisma.salonSettings.findUnique({
      where: { salonId }
    });
    const fallbackStart = salonSettings?.workStartHour ?? 9;
    const fallbackEnd = salonSettings?.workEndHour ?? 18;
    const slotInterval = salonSettings?.slotInterval ?? 30;

    const staffIds = staffServices.map((ss) => ss.staffId);
    const workingHoursMap = await this.getStaffWorkingHours(staffIds, dayOfWeek, fallbackStart, fallbackEnd);

    const constraints = await this.getConstraints(salonId, date);

    const slotStartCandidates = this.generateSlotStartTimes(
      date,
      staffIds,
      workingHoursMap,
      staffServices,
      slotInterval
    );

    const availableSlots = this.filterAvailableSlots(
      slotStartCandidates,
      staffServices,
      workingHoursMap,
      constraints,
      peopleCount
    );

    const rankedSlots = this.rankSlots(availableSlots);

    return {
      slots: rankedSlots,
      lockToken: this.generateLockToken()
    };
  }

  async calculateBundleAvailability(options: {
    date: Date;
    services: ServiceWithCategory[];
    peopleCount: number;
    salonId: number;
  }): Promise<AvailabilityResult> {
    const { date, services, peopleCount, salonId } = options;
    const first = services[0];
    if (!first) {
      return { slots: [], lockToken: this.generateLockToken() };
    }
    return this.calculateAvailability({
      date,
      serviceId: first.id,
      peopleCount,
      salonId
    });
  }

  private async getStaffForService(serviceId: number, salonId: number): Promise<{ staffId: number; duration: number }[]> {
    const rows = await prisma.staffService.findMany({
      where: {
        serviceId,
        Staff: { salonId },
        OR: [{ isactive: true }, { isactive: null }]
      },
      select: { staffId: true, duration: true }
    });
    return rows;
  }

  private async getStaffWorkingHours(
    staffIds: number[],
    dayOfWeek: number,
    fallbackStart: number,
    fallbackEnd: number
  ): Promise<Map<number, { startHour: number; endHour: number }>> {
    const map = new Map<number, { startHour: number; endHour: number }>();

    const hours = await prisma.staffWorkingHours.findMany({
      where: { staffId: { in: staffIds }, dayOfWeek }
    });

    for (const h of hours) {
      map.set(h.staffId, { startHour: h.startHour, endHour: h.endHour });
    }

    for (const staffId of staffIds) {
      if (!map.has(staffId)) {
        map.set(staffId, { startHour: fallbackStart, endHour: fallbackEnd });
      }
    }

    return map;
  }

  private generateSlotStartTimes(
    date: Date,
    staffIds: number[],
    workingHoursMap: Map<number, { startHour: number; endHour: number }>,
    staffServices: { staffId: number; duration: number }[],
    slotInterval: number
  ): Date[] {
    const staffDurations = new Map<number, number>();
    for (const ss of staffServices) {
      const existing = staffDurations.get(ss.staffId);
      if (existing === undefined || ss.duration < existing) {
        staffDurations.set(ss.staffId, ss.duration);
      }
    }

    let globalStart = 24 * 60;
    let globalEnd = 0;

    for (const staffId of staffIds) {
      const wh = workingHoursMap.get(staffId);
      if (!wh) continue;
      const duration = staffDurations.get(staffId) ?? 60;
      const staffStart = wh.startHour * 60;
      const staffEnd = (wh.endHour * 60) - duration;
      if (staffStart < globalStart) globalStart = staffStart;
      if (staffEnd > globalEnd) globalEnd = staffEnd;
    }

    if (globalStart >= globalEnd) return [];

    const starts: Date[] = [];
    for (let minutes = globalStart; minutes <= globalEnd; minutes += slotInterval) {
      const slotTime = new Date(date);
      slotTime.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
      starts.push(slotTime);
    }
    return starts;
  }

  private async getConstraints(
    salonId: number,
    date: Date
  ): Promise<{
    appointments: ConstraintAppointment[];
    leaves: ConstraintLeave[];
    locks: ConstraintLock[];
  }> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const [appointments, leaves, lockRows] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          salonId,
          status: 'BOOKED',
          startTime: { lt: endOfDay },
          endTime: { gt: startOfDay }
        },
        select: { id: true, staffId: true, startTime: true, endTime: true }
      }),
      prisma.leave.findMany({
        where: {
          staff: { salonId },
          startDate: { lte: endOfDay },
          endDate: { gte: startOfDay }
        },
        select: { id: true, staffId: true, startDate: true, endDate: true }
      }),
      prisma.$queryRaw<
        { id: string; tarih: string; saat: string; sure: string; expires_at: Date }[]
      >`
        SELECT id, tarih, saat, sure, expires_at
        FROM temporary_locks
        WHERE salon_id = ${salonId}
        AND expires_at > NOW()
        AND tarih = ${date.toISOString().split('T')[0]}
      `.catch(() => [])
    ]);

    const locks: ConstraintLock[] = lockRows.map((row) => {
      const [h, m] = row.saat.split(':').map(Number);
      const startMinutes = h * 60 + m;
      const duration = parseInt(row.sure, 10) || 60;
      const startTime = new Date(row.tarih);
      startTime.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
      const endTime = new Date(startTime.getTime() + duration * 60 * 1000);
      return {
        id: row.id,
        startTime,
        endTime,
        expiresAt: row.expires_at
      };
    });

    return {
      appointments: appointments.map((a) => ({
        id: a.id,
        staffId: a.staffId,
        startTime: a.startTime,
        endTime: a.endTime
      })),
      leaves: leaves.map((l) => ({
        id: l.id,
        staffId: l.staffId,
        startDate: l.startDate,
        endDate: l.endDate
      })),
      locks
    };
  }

  private filterAvailableSlots(
    slotStarts: Date[],
    staffServices: { staffId: number; duration: number }[],
    workingHoursMap: Map<number, { startHour: number; endHour: number }>,
    constraints: {
      appointments: ConstraintAppointment[];
      leaves: ConstraintLeave[];
      locks: ConstraintLock[];
    },
    peopleCount: number
  ): AvailabilitySlot[] {
    const slotMap = new Map<string, AvailabilitySlot>();

    for (const ss of staffServices) {
      const wh = workingHoursMap.get(ss.staffId);
      if (!wh) continue;

      for (const slotStart of slotStarts) {
        const hour = slotStart.getHours();
        const minute = slotStart.getMinutes();
        const slotStartMinutes = hour * 60 + minute;

        const workStartMinutes = wh.startHour * 60;
        const workEndMinutes = wh.endHour * 60;
        const slotEndMinutes = slotStartMinutes + ss.duration;

        if (slotStartMinutes < workStartMinutes || slotEndMinutes > workEndMinutes) {
          continue;
        }

        const slotEnd = new Date(slotStart.getTime() + ss.duration * 60 * 1000);

        const conflicts = this.checkSlotConflicts(slotStart, slotEnd, constraints);
        if (conflicts.some((c) => 'expiresAt' in c)) continue;

        const staffConflict = conflicts.some(
          (c) => 'staffId' in c && c.staffId === ss.staffId
        );
        if (staffConflict) continue;

        const key = `${slotStart.getTime()}-${slotEnd.getTime()}`;
        let slot = slotMap.get(key);
        if (!slot) {
          slot = {
            startTime: new Date(slotStart),
            endTime: new Date(slotEnd),
            availableStaff: [],
            optionId: uuidv4()
          };
          slotMap.set(key, slot);
        }
        if (!slot.availableStaff.includes(ss.staffId)) {
          slot.availableStaff.push(ss.staffId);
        }
      }
    }

    return [...slotMap.values()].filter((s) => s.availableStaff.length >= peopleCount);
  }

  private checkSlotConflicts(
    slotStart: Date,
    slotEnd: Date,
    constraints: {
      appointments: ConstraintAppointment[];
      leaves: ConstraintLeave[];
      locks: ConstraintLock[];
    }
  ): (ConstraintAppointment | ConstraintLeave | ConstraintLock)[] {
    const conflicts: (ConstraintAppointment | ConstraintLeave | ConstraintLock)[] = [];

    for (const apt of constraints.appointments) {
      if (this.timesOverlap(slotStart, slotEnd, apt.startTime, apt.endTime)) {
        conflicts.push(apt);
      }
    }

    for (const leave of constraints.leaves) {
      if (this.dateInRange(slotStart, leave.startDate, leave.endDate)) {
        conflicts.push(leave);
      }
    }

    const now = new Date();
    for (const lock of constraints.locks) {
      if (lock.expiresAt > now && this.timesOverlap(slotStart, slotEnd, lock.startTime, lock.endTime)) {
        conflicts.push(lock);
      }
    }

    return conflicts;
  }

  private rankSlots(slots: AvailabilitySlot[]): AvailabilitySlot[] {
    return [...slots].sort((a, b) => {
      const timeDiff = a.startTime.getTime() - b.startTime.getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.availableStaff.length - a.availableStaff.length;
    });
  }

  private generateLockToken(): LockToken {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);
    return {
      id: uuidv4(),
      expiresAt
    };
  }

  private timesOverlap(start1: Date, end1: Date, start2: Date, end2: Date): boolean {
    return start1.getTime() < end2.getTime() && end1.getTime() > start2.getTime();
  }

  private dateInRange(date: Date, rangeStart: Date, rangeEnd: Date): boolean {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const rs = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
    const re = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
    return d.getTime() >= rs.getTime() && d.getTime() <= re.getTime();
  }
}

export { AvailabilityEngine };
