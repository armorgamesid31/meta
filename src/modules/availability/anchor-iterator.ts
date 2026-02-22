import { prisma } from '../../prisma.js';
import { AvailabilityRequest, IndexedData, WorkingHoursRow } from './types.js';

export type TimeSlot = {
  hour: number; // minutes from midnight
  staffId: number;
};

export class AnchorIterator {
  private readonly MAX_ANCHORS = 500;

  async *iterateAnchors(
    request: AvailabilityRequest,
    date: Date,
    data: IndexedData
  ): AsyncGenerator<TimeSlot> {
    let anchorCount = 0;
    const dayOfWeek = date.getDay();
    const serviceIds = request.groups.flatMap(g => g.services);

    // Get relevant staff IDs based on requested services
    const relevantStaffIds = new Set<number>();
    for (const serviceId of serviceIds) {
      const staffServices = data.staffServicesByService.get(serviceId) || [];
      for (const ss of staffServices) {
        relevantStaffIds.add(ss.staffId);
      }
    }

    // 1. Staff Working Hour Anchors
    for (const staffId of relevantStaffIds) {
      const workingHoursKey = `${staffId}-${dayOfWeek}`;
      const workingHours = data.workingHoursByStaffAndDay.get(workingHoursKey);

      if (workingHours) {
        // Iterate every 5 minutes within working hours
        const startMinutes = workingHours.startHour * 60;
        const endMinutes = workingHours.endHour * 60;

        for (let time = startMinutes; time < endMinutes; time += 5) {
          if (anchorCount >= this.MAX_ANCHORS) {
            console.warn("ANCHOR_LIMIT_REACHED", { staffId, date: date.toISOString() });
            return;
          }
          yield { hour: time, staffId };
          anchorCount++;
        }
      }
    }

    // 2. Custom Slot Anchors (if any)
    // Fetch custom slots for relevant staff and services on this day
    const customSlots = await prisma.staffServiceCustomSlot.findMany({
      where: {
        StaffService: {
          serviceId: { in: serviceIds },
          staffId: { in: Array.from(relevantStaffIds) },
          isactive: true
        },
        dayOfWeek
      },
      include: {
        StaffService: true
      }
    });

    for (const slot of customSlots) {
      const slotTime = new Date(slot.startTime);
      const slotMinutes = slotTime.getHours() * 60 + slotTime.getMinutes();
      const staffId = slot.StaffService.staffId;

      // Apply ±15 minute flexibility in 5-minute increments
      for (let offset = -15; offset <= 15; offset += 5) {
        const time = slotMinutes + offset;
        
        // Ensure time is within working hours
        if (this.isWithinWorkingHours(time, staffId, dayOfWeek, data)) {
          if (anchorCount >= this.MAX_ANCHORS) {
            console.warn("ANCHOR_LIMIT_REACHED", { staffId, date: date.toISOString() });
            return;
          }
          yield { hour: time, staffId };
          anchorCount++;
        }
      }
    }
  }

  private isWithinWorkingHours(
    time: number,
    staffId: number,
    dayOfWeek: number,
    data: IndexedData
  ): boolean {
    const workingHoursKey = `${staffId}-${dayOfWeek}`;
    const workingHours = data.workingHoursByStaffAndDay.get(workingHoursKey);

    if (!workingHours) return false;

    const startMinutes = workingHours.startHour * 60;
    const endMinutes = workingHours.endHour * 60;

    return time >= startMinutes && time < endMinutes;
  }
}
