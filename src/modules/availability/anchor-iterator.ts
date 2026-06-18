import { prisma } from '../../prisma.js';
import { AvailabilityRequest, IndexedData, getAllowedStaffIdsForService, getGroupServiceIds, WorkingHoursRow } from './types.js';

export type TimeSlot = {
  hour: number; // minutes from midnight
  staffId: number;
};

export class AnchorIterator {
  // Eski tasarım: tek global 500'lük sayaç. Personeller working-hours
  // döngüsünde sırayla işlendiğinden, çok personelli + uzun mesaili salonda
  // (örn. 10 personel × 12 saat = 1440 adet 5dk anchor) ilk birkaç personel
  // 500'ü tüketip SONRAKİ personelleri sıfır-anchor bırakıyordu → o uzmanlar
  // müsaitlik sonucundan sessizce düşüyordu. Çözüm: personel-başına adil pay
  // + sonsuz büyümeye karşı global tavan.
  private readonly PER_STAFF_ANCHOR_CAP = 300; // ~25 saatlik 5dk slot — normal günü asla kesmez
  private readonly GLOBAL_ANCHOR_CAP = 6000; // güvenlik tavanı (~40 personel tam gün)

  async *iterateAnchors(
    request: AvailabilityRequest,
    date: Date,
    data: IndexedData
  ): AsyncGenerator<TimeSlot> {
    let anchorCount = 0;
    const dayOfWeek = date.getDay();
    const serviceIds = request.groups.flatMap((group) => getGroupServiceIds(group));

    // Get relevant staff IDs based on requested services
    const relevantStaffIds = new Set<number>();
    for (const group of request.groups) {
      for (const serviceId of getGroupServiceIds(group)) {
        const allowedStaffIds = getAllowedStaffIdsForService(group, serviceId);
        const staffServices = data.staffServicesByService.get(serviceId) || [];
        for (const ss of staffServices) {
          if (!allowedStaffIds || allowedStaffIds.includes(ss.staffId)) {
            relevantStaffIds.add(ss.staffId);
          }
        }
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

        // Her personele kendi payı — böylece çok personelli salonda kimse
        // sessizce düşmez. Global tavan yalnızca patolojik durumlar için.
        let staffAnchors = 0;
        for (let time = startMinutes; time < endMinutes; time += 5) {
          if (anchorCount >= this.GLOBAL_ANCHOR_CAP) {
            console.warn("ANCHOR_GLOBAL_LIMIT_REACHED", { staffId, anchorCount, date: date.toISOString() });
            return;
          }
          if (staffAnchors >= this.PER_STAFF_ANCHOR_CAP) break; // bu personelin payı doldu → sonraki personele geç
          yield { hour: time, staffId };
          anchorCount++;
          staffAnchors++;
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
          if (anchorCount >= this.GLOBAL_ANCHOR_CAP) {
            console.warn("ANCHOR_GLOBAL_LIMIT_REACHED", { staffId, anchorCount, date: date.toISOString() });
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
