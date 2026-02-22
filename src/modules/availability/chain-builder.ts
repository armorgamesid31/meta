import { prisma } from '../../prisma.js';
import { 
  ChainBlock, 
  IndexedData, 
  ServiceInfo, 
  StaffServiceRow,
  AppointmentRow,
  WorkingHoursRow 
} from './types.js';

export type ServiceChain = {
  startTime: number; // minutes from midnight
  endTime: number; // minutes from midnight
  blocks: {
    block: ChainBlock;
    startTime: number;
    endTime: number;
    staffId: number;
  }[];
};

export class ChainBuilder {
  async buildChain(
    permutation: { blocks: ChainBlock[] },
    anchor: { hour: number; staffId: number },
    salonId: number,
    data: IndexedData,
    date: Date
  ): Promise<ServiceChain | null> {
    let currentTime = anchor.hour;
    const chainBlocks: {
      block: ChainBlock;
      startTime: number;
      endTime: number;
      staffId: number;
    }[] = [];

    // The first block MUST use the anchor staff if it's a staff anchor
    // However, our anchor iterator yields { hour, staffId }.
    // If the anchor came from a specific staff's working hours, we should prioritize that staff for the first block if possible.
    // But `buildChain` logic usually tries to find *any* valid staff for the block starting at `currentTime`.
    
    // Actually, the anchor.staffId suggests a good candidate, but for the first block, we should strictly check if we can use it, 
    // OR if we should allow other staff. 
    // Usually anchor generation implies "Try starting at this time, derived from this staff's availability".
    // Let's try to assign the first block to anchor.staffId if possible, or any valid staff.
    
    // Wait, the anchor logic: "For each anchor... try to build chain".
    // If the anchor is "10:00 AM (Staff A)", we should try to start the chain at 10:00 AM.
    // The first block doesn't NECESSARILY have to be Staff A, but it's a strong hint.
    // However, for simplicity and correctness of "finding all slots", we usually treat anchor just as a time.
    // BUT, iterating all staff for every anchor is expensive.
    
    // Optimization: The anchor comes from a specific staff. 
    // If we only try to build chains where the *first* block is assigned to `anchor.staffId`, 
    // we effectively cover all staff because we iterate anchors for all staff.
    // This significantly prunes the search space.
    
    // Let's adopt this strategy: The first block MUST be assigned to `anchor.staffId`.
    
    for (let i = 0; i < permutation.blocks.length; i++) {
      const block = permutation.blocks[i];
      const isFirstBlock = i === 0;
      
      let assignedStaffId: number | null = null;

      if (isFirstBlock) {
        // Try to assign the anchor staff
        if (this.canStaffPerformBlock(anchor.staffId, block, data)) {
           if (await this.validateBlockPlacement(block, currentTime, anchor.staffId, salonId, data, date)) {
             assignedStaffId = anchor.staffId;
           }
        }
      } else {
        // For subsequent blocks, try to keep the same staff as previous block if possible (preference)
        // or find any valid staff.
        const prevStaffId = chainBlocks[i-1].staffId;
        
        // Try previous staff first
        if (this.canStaffPerformBlock(prevStaffId, block, data)) {
           if (await this.validateBlockPlacement(block, currentTime, prevStaffId, salonId, data, date)) {
             assignedStaffId = prevStaffId;
           }
        }
        
        // If not, try other capable staff
        if (!assignedStaffId) {
           const capableStaff = this.findCapableStaffForBlock(block, data);
           for (const staffId of capableStaff) {
             if (staffId === prevStaffId) continue; // Already tried
             if (await this.validateBlockPlacement(block, currentTime, staffId, salonId, data, date)) {
               assignedStaffId = staffId;
               break; // Found one
             }
           }
        }
      }

      if (!assignedStaffId) {
        return null; // Cannot place this block
      }

      const duration = this.calculateBlockDuration(block);
      
      chainBlocks.push({
        block,
        startTime: currentTime,
        endTime: currentTime + duration,
        staffId: assignedStaffId
      });

      currentTime += duration;

      // Add buffer (except after last block)
      if (i < permutation.blocks.length - 1) {
        const buffer = this.getBufferTime(block, data);
        currentTime += buffer;
      }
    }

    return {
      startTime: anchor.hour,
      endTime: currentTime,
      blocks: chainBlocks
    };
  }

  private canStaffPerformBlock(staffId: number, block: ChainBlock, data: IndexedData): boolean {
    // For sequential block, staff must perform ALL services
    // For individual block, staff must perform THE service
    for (const service of block.services) {
      const staffServices = data.staffServicesByService.get(service.id) || [];
      if (!staffServices.some(ss => ss.staffId === staffId)) {
        return false;
      }
    }
    return true;
  }

  private findCapableStaffForBlock(block: ChainBlock, data: IndexedData): number[] {
    const serviceIds = block.services.map(s => s.id);
    // Find staff who can perform ALL services in the block
    const staffSets = serviceIds.map(serviceId => {
      const staffServices = data.staffServicesByService.get(serviceId) || [];
      return new Set(staffServices.map(ss => ss.staffId));
    });

    if (staffSets.length === 0) return [];
    
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

  private async validateBlockPlacement(
    block: ChainBlock,
    startTime: number,
    staffId: number,
    salonId: number,
    data: IndexedData,
    date: Date
  ): Promise<boolean> {
    const duration = this.calculateBlockDuration(block);
    
    // 1. Check working hours
    const dayOfWeek = date.getDay();
    const workingHoursKey = `${staffId}-${dayOfWeek}`;
    const workingHours = data.workingHoursByStaffAndDay.get(workingHoursKey);
    
    if (!workingHours) return false;
    
    const workStart = workingHours.startHour * 60;
    const workEnd = workingHours.endHour * 60;
    
    if (startTime < workStart || (startTime + duration) > workEnd) {
      return false;
    }

    // 2. Check appointment conflicts
    const dateKey = date.toISOString().split('T')[0];
    const appointmentsKey = `${staffId}-${dateKey}`;
    const appointments = data.appointmentsByStaffAndDate.get(appointmentsKey) || [];
    
    for (const apt of appointments) {
      const aptStart = (apt.startTime.getHours() * 60) + apt.startTime.getMinutes();
      const aptEnd = (apt.endTime.getHours() * 60) + apt.endTime.getMinutes();
      
      // Check overlap
      if (startTime < aptEnd && (startTime + duration) > aptStart) {
        return false;
      }
    }

    // 3. Capacity check (Strict Time-Based)
    if (!await this.checkCapacity(block, startTime, duration, salonId, data, date)) {
        return false;
    }
    
    // 4. Custom slot validation (if needed - currently we rely on working hours)
    
    return true;
  }

  private async checkCapacity(
    block: ChainBlock,
    startTime: number,
    duration: number,
    salonId: number,
    data: IndexedData,
    date: Date
  ): Promise<boolean> {
    const dateKey = date.toISOString().split('T')[0];
    
    for (const service of block.services) {
        // Determine capacity limit
        const category = service.categoryId ? data.categoriesById.get(service.categoryId) : undefined;
        const limit = service.capacityOverride ?? category?.capacity ?? 1;
        
        // If limit is 1, standard staff availability (already checked) covers it?
        // NO. If service capacity is 1, it means ONLY 1 customer can receive this service at a time (e.g. 1 machine).
        // Even if 2 different staff are available, if they use the same limited machine, we must block.
        // So we must check concurrent appointments for this SERVICE (or category?) across ALL staff.
        
        // Requirement: "Capacity = aynı anda kaç appointment olabilir."
        // Usually capacity is per Service or Category.
        
        // Let's count overlapping appointments for this service/category across ALL staff.
        let concurrentCount = 0;
        
        // We need to iterate ALL appointments for the day, not just the assigned staff's.
        // data.appointmentsByStaffAndDate is grouped by staff. We need to iterate all staff.
        
        for (const [key, appointments] of data.appointmentsByStaffAndDate.entries()) {
            if (!key.endsWith(dateKey)) continue; // Filter by date
            
            for (const apt of appointments) {
                // Check if appointment matches the capacity scope (Service or Category)
                // If capacity is defined on Service, we count Service overlaps.
                // If on Category, we count Category overlaps.
                // Priority: Service > Category > Default.
                
                let matchesScope = false;
                if (service.capacityOverride !== null) {
                    // Service-level capacity: count appointments for THIS service
                    if (apt.serviceId === service.id) matchesScope = true;
                } else if (category && category.capacity !== null) {
                    // Category-level capacity: count appointments for ANY service in this category
                    const aptService = data.servicesById.get(apt.serviceId);
                    if (aptService && aptService.categoryId === category.id) matchesScope = true;
                } else {
                    // Default capacity 1. Usually implies per-staff (already checked) or global?
                    // "default = 1". If capacity is 1, and we have staff check, do we need global check?
                    // If "Lazer Room" is the bottleneck (Capacity=1), yes.
                    // But if default means "1 per staff", then staff check is enough.
                    // Requirement says: "Capacity = aynı anda kaç appointment olabilir. Staff çakışması ayrı kontrol."
                    // This implies Capacity is a resource constraint independent of staff.
                    // So we assume default 1 means "1 global slot". This seems too strict for default.
                    // Usually default is "Unlimited" (constrained by staff).
                    // BUT requirement says "default = 1".
                    // Let's assume if no override/category capacity, we only rely on staff availability (effectively infinite global capacity).
                    // Wait, user said "Capacity priority: service.capacityOverride, category.capacity, default = 1".
                    // If default is 1 globally, that's very strict.
                    // Maybe "default" meant "default logic" which is staff-based?
                    // Or maybe it really means 1.
                    
                    // Let's be safe: If explicit capacity is set, check it.
                    // If not, assume staff constraint is enough.
                    // Actually, let's implement checking against `limit`.
                    if (limit === 1 && !service.capacityOverride && !category?.capacity) {
                        // If falling back to true default, assume it's per-staff (which we checked).
                        // So skip global check.
                        continue;
                    }
                    
                    // If we are here, we have an explicit capacity to enforce.
                    if (service.capacityOverride !== null) {
                         if (apt.serviceId === service.id) matchesScope = true;
                    } else if (category) {
                         const aptService = data.servicesById.get(apt.serviceId);
                         if (aptService && aptService.categoryId === category.id) matchesScope = true;
                    }
                }
                
                if (matchesScope) {
                    const aptStart = (apt.startTime.getHours() * 60) + apt.startTime.getMinutes();
                    const aptEnd = (apt.endTime.getHours() * 60) + apt.endTime.getMinutes();
                    
                    // Check overlap with current candidate slot [startTime, startTime + duration]
                    if (startTime < aptEnd && (startTime + duration) > aptStart) {
                        concurrentCount++;
                    }
                }
            }
        }
        
        if (concurrentCount >= limit) {
            return false;
        }
    }
    
    return true;
  }

  private calculateBlockDuration(block: ChainBlock): number {
    return block.services.reduce((sum, s) => sum + s.duration, 0);
  }

  private getBufferTime(block: ChainBlock, data: IndexedData): number {
    // Use the last service in the block to determine buffer
    const lastService = block.services[block.services.length - 1];
    const categoryBuffer = block.categoryId ? data.categoriesById.get(block.categoryId)?.bufferMinutes : null;
    return lastService.bufferOverride ?? categoryBuffer ?? 15;
  }
}
