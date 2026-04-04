import { DatesRequest, DatesResponse } from './types.js';
import { SlotsEngine } from './slots-engine.js';

export class DatesEngine {
  async getAvailableDates(request: DatesRequest): Promise<DatesResponse> {
    const availableDates: string[] = [];
    const unavailableDates: string[] = [];
    const currentDate = new Date(`${request.startDate}T00:00:00`);
    const endDate = new Date(`${request.endDate}T00:00:00`);
    const slotsEngine = new SlotsEngine();

    while (currentDate <= endDate) {
      const date = currentDate.toISOString().split('T')[0];
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

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return { availableDates, unavailableDates };
  }
}
