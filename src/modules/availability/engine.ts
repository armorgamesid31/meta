import { v4 as uuidv4 } from 'uuid';
import {
  AvailabilitySlot,
  AvailabilityOptions,
  AvailabilityResult,
  LockToken,
  LegacyAppointmentRecord,
  LegacyLeaveRecord,
  LegacyLockRecord
} from './types';
import {
  DateNormalizer,
  AppointmentNormalizer,
  LeaveNormalizer,
  LockNormalizer
} from './normalizer';

class AvailabilityEngine {
  private readonly SLOT_INTERVAL_MINUTES = 15;

  /**
   * Calculate available time slots for a given date and service
   */
  async calculateAvailability(options: AvailabilityOptions): Promise<AvailabilityResult> {
    const { date, serviceId, peopleCount, salonId } = options;

    // Generate all possible 15-minute slots for the day
    const allSlots = this.generateTimeSlots(date);

    // Get all constraints (appointments, leaves, locks)
    const constraints = await this.getConstraints(salonId, date);

    // Filter available slots
    const availableSlots = this.filterAvailableSlots(allSlots, constraints, peopleCount);

    // Rank and limit slots
    const rankedSlots = this.rankSlots(availableSlots);

    // Generate lock token
    const lockToken = this.generateLockToken();

    return {
      slots: rankedSlots,
      lockToken
    };
  }

  /**
   * Generate all possible 15-minute time slots for a day (9 AM - 6 PM default)
   */
  private generateTimeSlots(date: Date): Date[] {
    const slots: Date[] = [];
    const startHour = 9; // 9 AM
    const endHour = 18; // 6 PM

    const startMinutes = startHour * 60;
    const endMinutes = endHour * 60;

    for (let minutes = startMinutes; minutes < endMinutes; minutes += this.SLOT_INTERVAL_MINUTES) {
      const slotTime = new Date(date);
      slotTime.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
      slots.push(slotTime);
    }

    return slots;
  }

  /**
   * Get all constraints for availability calculation
   */
  private async getConstraints(salonId: number, date: Date) {
    // This would normally query the database
    // For now, return empty arrays as placeholders
    const appointments: LegacyAppointmentRecord[] = [];
    const leaves: LegacyLeaveRecord[] = [];
    const locks: LegacyLockRecord[] = [];

    return {
      appointments: appointments.map(AppointmentNormalizer.normalize),
      leaves: leaves.map(LeaveNormalizer.normalize),
      locks: locks.map(LockNormalizer.normalize)
    };
  }

  /**
   * Filter slots based on constraints
   */
  private filterAvailableSlots(
    slots: Date[],
    constraints: {
      appointments: any[];
      leaves: any[];
      locks: any[];
    },
    peopleCount: number
  ): AvailabilitySlot[] {
    const availableSlots: AvailabilitySlot[] = [];

    for (const slotStart of slots) {
      const slotEnd = new Date(slotStart.getTime() + this.SLOT_INTERVAL_MINUTES * 60 * 1000);

      // Check if slot conflicts with any constraints
      const conflicts = this.checkSlotConflicts(slotStart, slotEnd, constraints);

      if (conflicts.length === 0) {
        // Slot is available - find available staff
        const availableStaff = this.findAvailableStaff(slotStart, slotEnd, constraints, peopleCount);

        if (availableStaff.length >= peopleCount) {
          availableSlots.push({
            startTime: slotStart,
            endTime: slotEnd,
            availableStaff,
            optionId: uuidv4()
          });
        }
      }
    }

    return availableSlots;
  }

  /**
   * Check if a time slot conflicts with any constraints
   */
  private checkSlotConflicts(
    slotStart: Date,
    slotEnd: Date,
    constraints: {
      appointments: any[];
      leaves: any[];
      locks: any[];
    }
  ): any[] {
    const conflicts: any[] = [];

    // Check appointments
    for (const appointment of constraints.appointments) {
      if (this.timesOverlap(slotStart, slotEnd, appointment.startTime, appointment.endTime)) {
        conflicts.push(appointment);
      }
    }

    // Check leaves
    for (const leave of constraints.leaves) {
      if (this.dateInRange(slotStart, leave.startDate, leave.endDate)) {
        conflicts.push(leave);
      }
    }

    // Check active locks
    for (const lock of constraints.locks) {
      if (lock.expiresAt > new Date() &&
          this.timesOverlap(slotStart, slotEnd, lock.startTime, lock.endTime)) {
        conflicts.push(lock);
      }
    }

    return conflicts;
  }

  /**
   * Find staff available for a time slot
   */
  private findAvailableStaff(
    slotStart: Date,
    slotEnd: Date,
    constraints: {
      appointments: any[];
      leaves: any[];
      locks: any[];
    },
    peopleCount: number
  ): number[] {
    // This is a simplified implementation
    // In reality, this would check staff schedules and availability
    const allStaffIds = [1, 2, 3, 4, 5]; // Example staff IDs

    const availableStaff: number[] = [];

    for (const staffId of allStaffIds) {
      let isAvailable = true;

      // Check if staff has appointments during this slot
      for (const appointment of constraints.appointments) {
        if (appointment.staffId === staffId &&
            this.timesOverlap(slotStart, slotEnd, appointment.startTime, appointment.endTime)) {
          isAvailable = false;
          break;
        }
      }

      // Check if staff is on leave
      if (isAvailable) {
        for (const leave of constraints.leaves) {
          if (leave.staffId === staffId &&
              this.dateInRange(slotStart, leave.startDate, leave.endDate)) {
            isAvailable = false;
            break;
          }
        }
      }

      if (isAvailable) {
        availableStaff.push(staffId);
      }
    }

    return availableStaff;
  }

  /**
   * Rank slots by preference (earliest first, then by staff availability)
   */
  private rankSlots(slots: AvailabilitySlot[]): AvailabilitySlot[] {
    return slots.sort((a, b) => {
      // Sort by start time first
      const timeDiff = a.startTime.getTime() - b.startTime.getTime();
      if (timeDiff !== 0) return timeDiff;

      // Then by number of available staff (more is better)
      return b.availableStaff.length - a.availableStaff.length;
    });
  }

  /**
   * Generate a lock token for the availability result
   */
  private generateLockToken(): LockToken {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15); // 15 minute lock

    return {
      id: uuidv4(),
      expiresAt
    };
  }

  /**
   * Check if two time ranges overlap
   */
  private timesOverlap(start1: Date, end1: Date, start2: Date, end2: Date): boolean {
    return start1 < end2 && end1 > start2;
  }

  /**
   * Check if a date is within a date range
   */
  private dateInRange(date: Date, start: Date, end: Date): boolean {
    const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const rangeStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const rangeEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());

    return checkDate >= rangeStart && checkDate <= rangeEnd;
  }
}

module.exports = { AvailabilityEngine };
