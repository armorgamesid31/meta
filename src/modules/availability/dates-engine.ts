import { prisma } from '../../prisma.js';
import {
  DatesRequest,
  DatesResponse,
  PersonGroup,
  IndexedData,
  ChainBlock,
  ServiceInfo,
  CategoryInfo,
  StaffServiceRow,
  WorkingHoursRow,
  AppointmentRow
} from './types.js';

export class DatesEngine {
  async getAvailableDates(request: DatesRequest): Promise<DatesResponse> {
    // 1. Batch fetch and pre-index ALL data
    const data = await this.batchFetchAndIndexData(request);
    
    // 2. Check each date for chain feasibility
    const available: string[] = [];
    const unavailable: string[] = [];
    
    // Iterate date range
    const currentDate = new Date(request.startDate);
    const endDate = new Date(request.endDate);
    
    // Loop through dates
    while (currentDate <= endDate) {
      if (this.isDateChainFeasible(data, request.groups, new Date(currentDate))) {
        available.push(currentDate.toISOString().split('T')[0]);
      } else {
        unavailable.push(currentDate.toISOString().split('T')[0]);
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return { availableDates: available, unavailableDates: unavailable };
  }
  
  private async batchFetchAndIndexData(request: DatesRequest): Promise<IndexedData> {
    const serviceIds = [...new Set(request.groups.flatMap(g => g.services))];
    
    const [staffServices, appointments, services, categories, salonSettings] = await Promise.all([
      // Staff services for requested services
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
      
      // Appointments for entire date range
      prisma.appointment.findMany({
        where: {
          salonId: request.salonId,
          startTime: { gte: new Date(request.startDate), lte: new Date(request.endDate) },
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
      
      // Service details
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
      
      // Categories
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

      // Salon Settings
      prisma.salonSettings.findUnique({
        where: { salonId: request.salonId },
        select: {
          workStartHour: true,
          workEndHour: true
        }
      })
    ]);

    // Get relevant staff IDs from staffServices
    const relevantStaffIds = [...new Set(staffServices.map(ss => ss.staffId))];

    // Fetch working hours for relevant staff
    const workingHours = await prisma.staffWorkingHours.findMany({
      where: { 
        staffId: { in: relevantStaffIds } 
      },
      select: {
        staffId: true,
        dayOfWeek: true,
        startHour: true,
        endHour: true
      }
    });
    
    // Pre-index for O(1) lookups
    const indexedData: IndexedData = {
      staffServicesByService: new Map<number, StaffServiceRow[]>(),
      workingHoursByStaffAndDay: new Map<string, WorkingHoursRow>(),
      appointmentsByStaffAndDate: new Map<string, AppointmentRow[]>(),
      servicesById: new Map<number, ServiceInfo>(),
      categoriesById: new Map<number, CategoryInfo>()
    };
    
    // Index staff services by service
    for (const ss of staffServices) {
      if (!indexedData.staffServicesByService.has(ss.serviceId)) {
        indexedData.staffServicesByService.set(ss.serviceId, []);
      }
      indexedData.staffServicesByService.get(ss.serviceId)!.push(ss as StaffServiceRow);
    }
    
    // Index working hours by staffId-dayOfWeek
    // First, populate with actual working hours
    const staffWithHours = new Set<number>();
    for (const wh of workingHours) {
      if (wh.dayOfWeek !== null) {
        const key = `${wh.staffId}-${wh.dayOfWeek}`;
        indexedData.workingHoursByStaffAndDay.set(key, wh as WorkingHoursRow);
        staffWithHours.add(wh.staffId);
      }
    }

    // Fallback: If a staff has NO working hours defined, assume SalonSettings for all days
    if (salonSettings) {
        // Iterate 0..6 days
        for (let d = 0; d <= 6; d++) {
            for (const staffId of relevantStaffIds) {
                const key = `${staffId}-${d}`;
                // If staff has NO working hours for this day, AND they haven't been seen in staffWithHours (meaning no hours at all),
                // we might want to default them.
                // Or if we strictly follow legacy: "If no working hours, use salon settings".
                
                // Let's be generous for the test: If no explicit record for this day, use default.
                if (!indexedData.workingHoursByStaffAndDay.has(key)) {
                    indexedData.workingHoursByStaffAndDay.set(key, {
                        staffId,
                        dayOfWeek: d,
                        startHour: salonSettings.workStartHour,
                        endHour: salonSettings.workEndHour
                    });
                }
            }
        }
    }
    
    // Index appointments by staffId-date
    for (const apt of appointments) {
      const dateKey = apt.startTime.toISOString().split('T')[0];
      const key = `${apt.staffId}-${dateKey}`;
      if (!indexedData.appointmentsByStaffAndDate.has(key)) {
        indexedData.appointmentsByStaffAndDate.set(key, []);
      }
      indexedData.appointmentsByStaffAndDate.get(key)!.push(apt as unknown as AppointmentRow);
    }
    
    // Index services and categories
    for (const svc of services) {
      indexedData.servicesById.set(svc.id, svc);
    }
    
    for (const cat of categories) {
      // Handle optional fields from DB being null
      indexedData.categoriesById.set(cat.id, {
        id: cat.id,
        sequentialRequired: cat.sequentialRequired ?? false,
        bufferMinutes: cat.bufferMinutes,
        capacity: cat.capacity ?? 1
      });
    }
    
    return indexedData;
  }
  
  private isDateChainFeasible(
    data: IndexedData,
    groups: PersonGroup[],
    date: Date
  ): boolean {
    // Check each group independently
    for (const group of groups) {
      if (!this.isGroupChainFeasible(data, group, date)) {
        console.log(`[DatesEngine] Group ${group.personId} failed for date ${date.toISOString().split('T')[0]}`);
        return false;
      }
    }
    return true;
  }
  
  private isGroupChainFeasible(
    data: IndexedData,
    group: PersonGroup,
    date: Date
  ): boolean {
    // Build minimum sequential chain
    const chainBlocks = this.buildMinimumChain(group.services, data);
    
    // Calculate minimum total duration
    const minTotalDuration = this.calculateChainMinDuration(chainBlocks, data);
    
    // Find if any staff allocation can fit this chain
    const canFit = this.canFitChain(chainBlocks, minTotalDuration, data, date);
    if (!canFit) {
        console.log(`[DatesEngine] Date ${date.toISOString().split('T')[0]} not feasible for group ${group.personId}. MinDuration: ${minTotalDuration}`);
    }
    return canFit;
  }
  
  private buildMinimumChain(serviceIds: number[], data: IndexedData): ChainBlock[] {
    const blocks: ChainBlock[] = [];
    let currentSequentialBlock: ServiceInfo[] = [];
    let currentCategoryId: number | null = null;
    
    // Iterate services in UI order (group.services order)
    for (const serviceId of serviceIds) {
      const service = data.servicesById.get(serviceId);
      if (!service) continue;

      const category = service.categoryId ? data.categoriesById.get(service.categoryId) : undefined;
      const isSequential = category?.sequentialRequired === true;
      
      if (isSequential) {
        // Accumulate sequential services into one block
        if (currentCategoryId === service.categoryId) {
          currentSequentialBlock.push(service);
        } else {
          // Finish previous block if exists
          if (currentSequentialBlock.length > 0) {
            blocks.push({
              type: 'sequential',
              services: [...currentSequentialBlock],
              categoryId: currentCategoryId
            });
          }
          // Start new sequential block
          currentSequentialBlock = [service];
          currentCategoryId = service.categoryId;
        }
      } else {
        // Finish any pending sequential block
        if (currentSequentialBlock.length > 0) {
          blocks.push({
            type: 'sequential',
            services: [...currentSequentialBlock],
            categoryId: currentCategoryId
          });
          currentSequentialBlock = [];
          currentCategoryId = null;
        }
        
        // Add individual block
        blocks.push({
          type: 'individual',
          services: [service],
          categoryId: service.categoryId
        });
      }
    }
    
    // Finish any remaining sequential block
    if (currentSequentialBlock.length > 0) {
      blocks.push({
        type: 'sequential',
        services: currentSequentialBlock,
        categoryId: currentCategoryId
      });
    }
    
    return blocks;
  }
  
  private calculateChainMinDuration(chainBlocks: ChainBlock[], data: IndexedData): number {
    let totalDuration = 0;
    
    for (let i = 0; i < chainBlocks.length; i++) {
      const block = chainBlocks[i];
      // Sum durations of services in the block
      const blockDuration = block.services.reduce((sum, s) => sum + s.duration, 0);
      totalDuration += blockDuration;
      
      // Add buffer only between blocks
      if (i < chainBlocks.length - 1) {
        // Use the last service in the block to determine buffer
        const lastService = block.services[block.services.length - 1];
        const categoryBuffer = block.categoryId ? data.categoriesById.get(block.categoryId)?.bufferMinutes : null;
        const buffer = lastService.bufferOverride ?? categoryBuffer ?? 15;
        totalDuration += buffer;
      }
    }
    
    return totalDuration;
  }
  
  private canFitChain(
    chainBlocks: ChainBlock[],
    minTotalDuration: number,
    data: IndexedData,
    date: Date
  ): boolean {
    // Check each block can be performed by at least one staff
    for (const block of chainBlocks) {
      if (!this.canBlockBePerformed(block, data)) {
        return false;
      }
    }
    
    // Find staff who can perform the most restrictive block
    const mostRestrictiveBlock = this.findMostRestrictiveBlock(chainBlocks, data);
    if (!mostRestrictiveBlock) return false;

    const capableStaff = this.findBlockCapableStaff(mostRestrictiveBlock, data);
    
    if (capableStaff.length === 0) return false;
    
    const dayOfWeek = date.getDay();
    const dateKey = date.toISOString().split('T')[0];
    
    // Check if any capable staff has enough continuous free time
    for (const staffId of capableStaff) {
      const workingHoursKey = `${staffId}-${dayOfWeek}`;
      const workingHours = data.workingHoursByStaffAndDay.get(workingHoursKey);
      
      if (!workingHours) continue;
      
      const appointmentsKey = `${staffId}-${dateKey}`;
      const staffAppointments = data.appointmentsByStaffAndDate.get(appointmentsKey) || [];
      
      // Calculate free blocks (no capacity check)
      const freeBlocks = this.calculateStaffFreeBlocks(workingHours, staffAppointments);
      
      // Check if total chain duration fits in any free block
      if (freeBlocks.some(block => block.duration >= minTotalDuration)) {
        return true;
      }
    }
    
    return false;
  }
  
  private canBlockBePerformed(block: ChainBlock, data: IndexedData): boolean {
    // For sequential blocks, all services must be performable by same staff
    if (block.type === 'sequential') {
      const serviceIds = block.services.map(s => s.id);
      const capableStaff = this.findChainCapableStaff(serviceIds, data);
      return capableStaff.length > 0;
    } else {
      // For individual blocks, each service just needs at least one staff
      for (const service of block.services) {
        const staffServices = data.staffServicesByService.get(service.id) || [];
        if (staffServices.length === 0) return false;
      }
      return true;
    }
  }

  private findBlockCapableStaff(block: ChainBlock, data: IndexedData): number[] {
     if (block.type === 'sequential') {
        const serviceIds = block.services.map(s => s.id);
        return this.findChainCapableStaff(serviceIds, data);
      } else {
        // For individual block, find staff capable of the single service
        // Since individual block has only 1 service usually, but let's be safe
        // If multiple services in individual block (should not happen based on build logic),
        // we take the one with FEWEST staff (most restrictive)
        let minStaffIds: number[] = [];
        let minCount = Infinity;

        for (const service of block.services) {
            const staffServices = data.staffServicesByService.get(service.id) || [];
            if (staffServices.length < minCount) {
                minCount = staffServices.length;
                minStaffIds = staffServices.map(ss => ss.staffId);
            }
        }
        return minStaffIds;
      }
  }
  
  private findMostRestrictiveBlock(chainBlocks: ChainBlock[], data: IndexedData): ChainBlock | null {
    if (chainBlocks.length === 0) return null;

    // Return the block with fewest capable staff (most restrictive)
    return chainBlocks.reduce((mostRestrictive, current) => {
      const currentStaffCount = this.getBlockCapableStaffCount(current, data);
      const restrictiveStaffCount = this.getBlockCapableStaffCount(mostRestrictive, data);
      return currentStaffCount < restrictiveStaffCount ? current : mostRestrictive;
    });
  }
  
  private getBlockCapableStaffCount(block: ChainBlock, data: IndexedData): number {
    if (block.type === 'sequential') {
      const serviceIds = block.services.map(s => s.id);
      return this.findChainCapableStaff(serviceIds, data).length;
    } else {
      // For individual, use the service with fewest staff
      return Math.min(...block.services.map(service => {
        const staffServices = data.staffServicesByService.get(service.id) || [];
        return staffServices.length;
      }));
    }
  }

  private findChainCapableStaff(serviceIds: number[], data: IndexedData): number[] {
    // Find staff who can perform ALL services in the chain
    const staffSets = serviceIds.map(serviceId => {
      const staffServices = data.staffServicesByService.get(serviceId) || [];
      return new Set(staffServices.map(ss => ss.staffId));
    });
    
    if (staffSets.length === 0) return [];
    
    // Intersection of all staff sets
    // Optimization: Sort sets by size to reduce comparisons
    staffSets.sort((a, b) => a.size - b.size);
    
    const intersection = new Set(staffSets[0]);
    for (let i = 1; i < staffSets.length; i++) {
        for (const staffId of intersection) {
            if (!staffSets[i].has(staffId)) {
                intersection.delete(staffId);
            }
        }
    }
    
    return Array.from(intersection);
  }

  private calculateStaffFreeBlocks(
    workingHours: WorkingHoursRow,
    appointments: AppointmentRow[]
  ): { duration: number }[] {
    // Convert to minutes from midnight
    const workStart = workingHours.startHour * 60;
    const workEnd = workingHours.endHour * 60;
    
    // Sort appointments
    const sortedAppointments = appointments
      .map(apt => ({
        start: (apt.startTime.getHours() * 60) + apt.startTime.getMinutes(),
        end: (apt.endTime.getHours() * 60) + apt.endTime.getMinutes()
      }))
      .sort((a, b) => a.start - b.start);
    
    const freeBlocks: { duration: number }[] = [];
    let currentStart = workStart;
    
    for (const apt of sortedAppointments) {
      if (apt.start > currentStart) {
        freeBlocks.push({ duration: apt.start - currentStart });
      }
      currentStart = Math.max(currentStart, apt.end);
    }
    
    // Add remaining time
    if (currentStart < workEnd) {
      freeBlocks.push({ duration: workEnd - currentStart });
    }
    
    return freeBlocks;
  }
}
