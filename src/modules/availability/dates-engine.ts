import { prisma } from '../../prisma.js';
import { DatesRequest, DatesResponse } from './types.js';
import { SlotsEngine } from './slots-engine.js';

const DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/**
 * Local YYYY-MM-DD without going through toISOString (which converts to
 * UTC and rolls back to the previous day in TZ=Europe/Istanbul when it's
 * just past midnight).
 */
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export class DatesEngine {
  async getAvailableDates(request: DatesRequest): Promise<DatesResponse> {
    const availableDates: string[] = [];
    const unavailableDates: string[] = [];
    const closedDates: string[] = [];

    // Salon working days (panel ayarı). Tanımlıysa o gün listede yoksa
    // gün kapalı sayılır — motor çağrılmaz, closedDates'e düşer.
    const settings = await prisma.salonSettings.findUnique({
      where: { salonId: request.salonId },
      select: { workingDays: true },
    });
    const workingDays = Array.isArray(settings?.workingDays)
      ? (settings!.workingDays as unknown[])
          .map((d) => String(d).toUpperCase().trim())
          .filter((d): d is typeof DAY_KEYS[number] => DAY_KEYS.includes(d as typeof DAY_KEYS[number]))
      : null;

    // Geçmiş gün filtresi — server-local "bugün". TZ=Europe/Istanbul
    // bootstrap.ts'te kilitli; salon-local takvim gününe denk gelir.
    const now = new Date();
    const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const currentDate = new Date(`${request.startDate}T00:00:00`);
    const endDate = new Date(`${request.endDate}T00:00:00`);
    const slotsEngine = new SlotsEngine();

    while (currentDate <= endDate) {
      const date = formatLocalDate(currentDate);
      const dayLocal = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()).getTime();

      if (dayLocal < todayLocal) {
        // Geçmiş gün — motor çağırmaya gerek yok.
        unavailableDates.push(date);
      } else if (workingDays !== null && !workingDays.includes(DAY_KEYS[currentDate.getDay()])) {
        // Salon o gün kapalı (panel ayarı).
        closedDates.push(date);
      } else {
        const result = await slotsEngine.generateSlots(
          {
            salonId: request.salonId,
            date,
            groups: request.groups,
          },
          { persistSearchContext: false },
        );
        if (result.displaySlots.length > 0) {
          availableDates.push(date);
        } else {
          unavailableDates.push(date);
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return { availableDates, unavailableDates, closedDates };
  }
}
