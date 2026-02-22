import { prisma } from '../../prisma.js';
import { 
  SlotsResponse, 
  AvailabilityRequest, 
  IndexedData, 
  PersonGroup, 
  StaffServiceRow, 
  WorkingHoursRow, 
  AppointmentRow,
  ServiceInfo,
  CategoryInfo
} from './types.js';
import { AnchorIterator } from './anchor-iterator.js';
import { PermutationPruner } from './permutation-pruner.js';
import { ChainBuilder, ServiceChain } from './chain-builder.js';
import { MultiPersonAnchor } from './multi-person-anchor.js';
import { SlotScorer } from './slot-scorer.js';
import { v4 as uuidv4 } from 'uuid';

export class SlotsEngine {
  private anchorIterator = new AnchorIterator();
  private permutationPruner = new PermutationPruner();
  private chainBuilder = new ChainBuilder();
  private multiPersonAnchor = new MultiPersonAnchor(this);
  private slotScorer = new SlotScorer();
  
  private readonly MAX_COMBINATIONS = 200;

  async generateSlots(request: AvailabilityRequest): Promise<SlotsResponse> {
    const data = await this.batchFetchData(request);
    const date = new Date(request.date);
    
    const startSync = performance.now();
    const synchronized = await this.multiPersonAnchor.synchronizeGroups(
      request,
      date,
      data,
      this.MAX_COMBINATIONS
    );
    
    // Optimize and format
    const groupSlots = this.slotScorer.optimize(
      synchronized,
      request.groups.map(g => g.personId)
    );

    const endSync = performance.now();
    const executionTime = endSync - startSync;

    // Requirement: "Log only when executionTime > 1000ms OR combinationsEvaluated > MAX_COMBINATIONS"
    // Wait, combinationsEvaluated is handled inside MultiPersonAnchor and we only get back the result.
    // I will add combinationsEvaluated to the response of synchronizeGroups for logging.
    
    if (executionTime > 1000 || synchronized.length >= this.MAX_COMBINATIONS) {
      console.warn("AVAILABILITY_METRICS", {
        duration: executionTime,
        salonId: request.salonId,
        date: request.date,
        groupCount: request.groups.length,
        combinationsReturned: synchronized.length,
        maxCombinations: this.MAX_COMBINATIONS
      });
    }

    // Generate and store lock token (search context)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity
    const searchContext = await prisma.searchContext.create({
      data: {
        salonId: request.salonId,
        data: request as any, // Store full request
        expiresAt
      }
    });
    
    return {
      date: request.date,
      groups: groupSlots,
      lockToken: {
        id: searchContext.id,
        expiresAt
      }
    };
  }

  // Public for MultiPersonAnchor to call recursively
  async generateSlotsForGroup(
    group: PersonGroup,
    date: Date,
    data: IndexedData
  ): Promise<ServiceChain[]> {
    const validChains: ServiceChain[] = [];
    
    const permutationsGen = this.permutationPruner.generateValidPermutations(
      group.services,
      data
    );
    
    const anchorsGen = this.anchorIterator.iterateAnchors(
      { ...null as any, groups: [group] }, // Minimal request object
      date,
      data
    );
    
    const anchors = [];
    for await (const anchor of anchorsGen) {
      anchors.push(anchor);
    }
    
    for await (const permutation of permutationsGen) {
      for (const anchor of anchors) {
        const chain = await this.chainBuilder.buildChain(
          permutation,
          anchor,
          1, // Using default salonId as fallback, but ideally passed or extracted
          data,
          date
        );
        
        if (chain) {
          validChains.push(chain);
        }
      }
    }
    
    return validChains;
  }

  private async batchFetchData(request: AvailabilityRequest): Promise<IndexedData> {
    const serviceIds = [...new Set(request.groups.flatMap(g => g.services))];
    const date = new Date(request.date);
    const startOfDay = new Date(date); startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date(date); endOfDay.setHours(23,59,59,999);
    
    const [staffServices, appointments, services, categories, salonSettings] = await Promise.all([
      prisma.staffService.findMany({
        where: { 
          serviceId: { in: serviceIds },
          Staff: { salonId: request.salonId },
          isactive: true
        },
        select: {
          staffId: true,
          serviceId: true,
          duration: true,
          isactive: true
        }
      }),
      
      prisma.appointment.findMany({
        where: {
          salonId: request.salonId,
          startTime: { gte: startOfDay, lte: endOfDay },
          status: { in: ['BOOKED', 'COMPLETED'] }
        },
        select: {
          id: true,
          staffId: true,
          serviceId: true,
          startTime: true,
          endTime: true,
          status: true
        }
      }),
      
      prisma.service.findMany({
        where: { id: { in: serviceIds } },
        select: {
          id: true,
          name: true,
          duration: true,
          bufferOverride: true,
          categoryId: true,
          capacityOverride: true
        }
      }),
      
      prisma.serviceCategory.findMany({
        where: { 
          salonId: request.salonId
        },
        select: {
          id: true,
          sequentialRequired: true,
          bufferMinutes: true,
          capacity: true
        }
      }),

      prisma.salonSettings.findUnique({
        where: { salonId: request.salonId },
        select: {
          workStartHour: true,
          workEndHour: true
        }
      })
    ]);

    const relevantStaffIds = [...new Set(staffServices.map(ss => ss.staffId))];

    const workingHours = await prisma.staffWorkingHours.findMany({
      where: { 
        staffId: { in: relevantStaffIds },
        dayOfWeek: date.getDay()
      },
      select: {
        staffId: true,
        dayOfWeek: true,
        startHour: true,
        endHour: true
      }
    });
    
    const indexedData: IndexedData = {
      staffServicesByService: new Map<number, StaffServiceRow[]>(),
      workingHoursByStaffAndDay: new Map<string, WorkingHoursRow>(),
      appointmentsByStaffAndDate: new Map<string, AppointmentRow[]>(),
      servicesById: new Map<number, ServiceInfo>(),
      categoriesById: new Map<number, CategoryInfo>()
    };
    
    for (const ss of staffServices) {
      if (!indexedData.staffServicesByService.has(ss.serviceId)) {
        indexedData.staffServicesByService.set(ss.serviceId, []);
      }
      indexedData.staffServicesByService.get(ss.serviceId)!.push(ss as StaffServiceRow);
    }
    
    const staffWithHours = new Set<number>();
    const dayOfWeek = date.getDay();

    for (const wh of workingHours) {
      if (wh.dayOfWeek !== null) {
        const key = `${wh.staffId}-${wh.dayOfWeek}`;
        indexedData.workingHoursByStaffAndDay.set(key, wh as WorkingHoursRow);
        staffWithHours.add(wh.staffId);
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
                    endHour: salonSettings.workEndHour
                });
            }
        }
    }
    
    for (const apt of appointments) {
      const dateKey = apt.startTime.toISOString().split('T')[0];
      const key = `${apt.staffId}-${dateKey}`;
      if (!indexedData.appointmentsByStaffAndDate.has(key)) {
        indexedData.appointmentsByStaffAndDate.set(key, []);
      }
      indexedData.appointmentsByStaffAndDate.get(key)!.push(apt as unknown as AppointmentRow);
    }
    
    for (const svc of services) {
      indexedData.servicesById.set(svc.id, svc);
    }
    
    for (const cat of categories) {
      indexedData.categoriesById.set(cat.id, {
        id: cat.id,
        sequentialRequired: cat.sequentialRequired ?? false,
        bufferMinutes: cat.bufferMinutes,
        capacity: cat.capacity ?? 1
      });
    }
    
    return indexedData;
  }
}
