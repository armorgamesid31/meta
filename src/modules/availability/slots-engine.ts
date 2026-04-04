import { prisma } from '../../prisma.js';
import {
  AvailabilityRequest,
  AppointmentRow,
  CategoryInfo,
  getGroupServiceIds,
  IndexedData,
  PersonGroup,
  ServiceInfo,
  SlotsResponse,
  StaffServiceRow,
  WorkingHoursRow,
} from './types.js';
import { AnchorIterator } from './anchor-iterator.js';
import { PermutationPruner } from './permutation-pruner.js';
import { ChainBuilder, ServiceChain } from './chain-builder.js';
import { MultiPersonAnchor } from './multi-person-anchor.js';
import { SlotScorer } from './slot-scorer.js';

export type GenerateSlotsOptions = {
  persistSearchContext?: boolean;
};

export class SlotsEngine {
  private anchorIterator = new AnchorIterator();
  private permutationPruner = new PermutationPruner();
  private chainBuilder = new ChainBuilder();
  private multiPersonAnchor = new MultiPersonAnchor(this);
  private slotScorer = new SlotScorer();

  private readonly MAX_COMBINATIONS = 200;

  async generateSlots(
    request: AvailabilityRequest,
    options: GenerateSlotsOptions = {},
  ): Promise<SlotsResponse> {
    const data = await this.batchFetchData(request);
    const date = new Date(request.date);

    const startSync = performance.now();
    const synchronized = await this.multiPersonAnchor.synchronizeGroups(
      request,
      date,
      data,
      this.MAX_COMBINATIONS,
    );

    const optimized = this.slotScorer.optimize(
      synchronized,
      request.groups.map((group) => group.personId),
    );

    const endSync = performance.now();
    const executionTime = endSync - startSync;

    if (executionTime > 1000 || synchronized.length >= this.MAX_COMBINATIONS) {
      console.warn('AVAILABILITY_METRICS', {
        duration: executionTime,
        salonId: request.salonId,
        date: request.date,
        groupCount: request.groups.length,
        combinationsReturned: synchronized.length,
        maxCombinations: this.MAX_COMBINATIONS,
      });
    }

    if (options.persistSearchContext === false) {
      return {
        date: request.date,
        groups: optimized.groups,
        displaySlots: optimized.displaySlots,
      };
    }

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const searchContext = await prisma.searchContext.create({
      data: {
        salonId: request.salonId,
        data: request as any,
        expiresAt,
      },
    });

    return {
      date: request.date,
      groups: optimized.groups,
      displaySlots: optimized.displaySlots,
      lockToken: {
        id: searchContext.id,
        expiresAt,
      },
    };
  }

  async generateSlotsForGroup(
    group: PersonGroup,
    date: Date,
    data: IndexedData,
  ): Promise<ServiceChain[]> {
    const validChains: ServiceChain[] = [];

    const permutationsGen = this.permutationPruner.generateValidPermutations(
      getGroupServiceIds(group),
      data,
    );

    const anchorsGen = this.anchorIterator.iterateAnchors(
      {
        salonId: 0,
        date: date.toISOString().split('T')[0],
        groups: [group],
      },
      date,
      data,
    );

    const anchors = [] as Array<{ hour: number; staffId: number }>;
    for await (const anchor of anchorsGen) {
      anchors.push(anchor);
    }

    for await (const permutation of permutationsGen) {
      for (const anchor of anchors) {
        const chain = await this.chainBuilder.buildChain(
          permutation,
          anchor,
          1,
          data,
          date,
          group,
        );

        if (chain) {
          validChains.push(chain);
        }
      }
    }

    return validChains;
  }

  private async batchFetchData(request: AvailabilityRequest): Promise<IndexedData> {
    const serviceIds = [...new Set(request.groups.flatMap((group) => getGroupServiceIds(group)))];
    const date = new Date(request.date);
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const [staffServices, appointments, services, categories, salonSettings] = await Promise.all([
      prisma.staffService.findMany({
        where: {
          serviceId: { in: serviceIds },
          Staff: { salonId: request.salonId },
          isactive: true,
        },
        select: {
          staffId: true,
          serviceId: true,
          duration: true,
          isactive: true,
        },
      }),

      prisma.appointment.findMany({
        where: {
          salonId: request.salonId,
          startTime: { gte: startOfDay, lte: endOfDay },
          status: { in: ['BOOKED', 'COMPLETED'] },
        },
        select: {
          id: true,
          staffId: true,
          serviceId: true,
          startTime: true,
          endTime: true,
          status: true,
        },
      }),

      prisma.service.findMany({
        where: { id: { in: serviceIds } },
        select: {
          id: true,
          name: true,
          duration: true,
          bufferOverride: true,
          categoryId: true,
          capacityOverride: true,
        },
      }),

      prisma.serviceCategory.findMany({
        where: {
          salonId: request.salonId,
        },
        select: {
          id: true,
          sequentialRequired: true,
          bufferMinutes: true,
          capacity: true,
        },
      }),

      prisma.salonSettings.findUnique({
        where: { salonId: request.salonId },
        select: {
          workStartHour: true,
          workEndHour: true,
        },
      }),
    ]);

    const relevantStaffIds = [...new Set(staffServices.map((row) => row.staffId))];

    const workingHours = await prisma.staffWorkingHours.findMany({
      where: {
        staffId: { in: relevantStaffIds },
        dayOfWeek: date.getDay(),
      },
      select: {
        staffId: true,
        dayOfWeek: true,
        startHour: true,
        endHour: true,
      },
    });

    const indexedData: IndexedData = {
      staffServicesByService: new Map<number, StaffServiceRow[]>(),
      workingHoursByStaffAndDay: new Map<string, WorkingHoursRow>(),
      appointmentsByStaffAndDate: new Map<string, AppointmentRow[]>(),
      servicesById: new Map<number, ServiceInfo>(),
      categoriesById: new Map<number, CategoryInfo>(),
    };

    for (const staffService of staffServices) {
      if (!indexedData.staffServicesByService.has(staffService.serviceId)) {
        indexedData.staffServicesByService.set(staffService.serviceId, []);
      }
      indexedData.staffServicesByService.get(staffService.serviceId)!.push(staffService as StaffServiceRow);
    }

    const dayOfWeek = date.getDay();
    for (const workingHour of workingHours) {
      if (workingHour.dayOfWeek !== null) {
        const key = `${workingHour.staffId}-${workingHour.dayOfWeek}`;
        indexedData.workingHoursByStaffAndDay.set(key, workingHour as WorkingHoursRow);
      }
    }

    if (salonSettings) {
      for (const staffId of relevantStaffIds) {
        const key = `${staffId}-${dayOfWeek}`;
        if (!indexedData.workingHoursByStaffAndDay.has(key)) {
          indexedData.workingHoursByStaffAndDay.set(key, {
            staffId,
            dayOfWeek,
            startHour: salonSettings.workStartHour,
            endHour: salonSettings.workEndHour,
          });
        }
      }
    }

    for (const appointment of appointments) {
      const dateKey = appointment.startTime.toISOString().split('T')[0];
      const key = `${appointment.staffId}-${dateKey}`;
      if (!indexedData.appointmentsByStaffAndDate.has(key)) {
        indexedData.appointmentsByStaffAndDate.set(key, []);
      }
      indexedData.appointmentsByStaffAndDate.get(key)!.push(appointment as unknown as AppointmentRow);
    }

    for (const service of services) {
      indexedData.servicesById.set(service.id, service);
    }

    for (const category of categories) {
      indexedData.categoriesById.set(category.id, {
        id: category.id,
        sequentialRequired: category.sequentialRequired ?? false,
        bufferMinutes: category.bufferMinutes,
        capacity: category.capacity ?? 1,
      });
    }

    return indexedData;
  }
}
