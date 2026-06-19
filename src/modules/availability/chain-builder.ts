import { prisma } from '../../prisma.js';
import { 
  ChainBlock, 
  IndexedData, 
  ServiceInfo, 
  StaffServiceRow,
  AppointmentRow,
  WorkingHoursRow,
  PersonGroup,
  getAllowedStaffIdsForService,
  localDateKey,
} from './types.js';

export type ServiceChain = {
  startTime: number; // minutes from midnight
  endTime: number; // minutes from midnight
  blocks: {
    block: ChainBlock;
    startTime: number;
    endTime: number;
    staffId: number;
    /**
     * Per-service durations after staff override + gender variant
     * resolution, parallel to block.services. slot-scorer uses these to
     * walk the service sequence with correct intra-block boundaries.
     */
    serviceDurations: number[];
  }[];
};

export class ChainBuilder {
  async buildChain(
    permutation: { blocks: ChainBlock[] },
    anchor: { hour: number; staffId: number },
    salonId: number,
    data: IndexedData,
    date: Date,
    group?: PersonGroup
  ): Promise<ServiceChain | null> {
    let currentTime = anchor.hour;
    const chainBlocks: {
      block: ChainBlock;
      startTime: number;
      endTime: number;
      staffId: number;
      serviceDurations: number[];
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
        if (this.canStaffPerformBlock(anchor.staffId, block, data, group)) {
           if (await this.validateBlockPlacement(block, currentTime, anchor.staffId, salonId, data, date, group?.gender)) {
             assignedStaffId = anchor.staffId;
           }
        }
      } else {
        // For subsequent blocks, try to keep the same staff as previous block if possible (preference)
        // or find any valid staff.
        const prevStaffId = chainBlocks[i-1].staffId;
        
        // Try previous staff first
        if (this.canStaffPerformBlock(prevStaffId, block, data, group)) {
           if (await this.validateBlockPlacement(block, currentTime, prevStaffId, salonId, data, date, group?.gender)) {
             assignedStaffId = prevStaffId;
           }
        }
        
        // If not, try other capable staff
        if (!assignedStaffId) {
           const capableStaff = this.findCapableStaffForBlock(block, data, group);
           for (const staffId of capableStaff) {
             if (staffId === prevStaffId) continue; // Already tried
             if (await this.validateBlockPlacement(block, currentTime, staffId, salonId, data, date, group?.gender)) {
               assignedStaffId = staffId;
               break; // Found one
             }
           }
        }
      }

      if (!assignedStaffId) {
        return null; // Cannot place this block
      }

      const serviceDurations = this.calculateServiceDurations(block, assignedStaffId, data, group?.gender);
      const duration = serviceDurations.reduce((sum, d) => sum + d, 0);

      chainBlocks.push({
        block,
        startTime: currentTime,
        endTime: currentTime + duration,
        staffId: assignedStaffId,
        serviceDurations,
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

  private canStaffPerformBlock(staffId: number, block: ChainBlock, data: IndexedData, group?: PersonGroup): boolean {
    // For sequential block, staff must perform ALL services
    // For individual block, staff must perform THE service
    for (const service of block.services) {
      const allowedStaffIds = group ? getAllowedStaffIdsForService(group, service.id) : null;
      if (allowedStaffIds && !allowedStaffIds.includes(staffId)) {
        return false;
      }
      const staffServices = data.staffServicesByService.get(service.id) || [];
      if (!staffServices.some(ss => ss.staffId === staffId)) {
        return false;
      }
    }
    return true;
  }

  private findCapableStaffForBlock(block: ChainBlock, data: IndexedData, group?: PersonGroup): number[] {
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
    
    return Array.from(intersection).filter((staffId) =>
      block.services.every((service) => {
        const allowedStaffIds = group ? getAllowedStaffIdsForService(group, service.id) : null;
        return !allowedStaffIds || allowedStaffIds.includes(staffId);
      }),
    );
  }

  private async validateBlockPlacement(
    block: ChainBlock,
    startTime: number,
    staffId: number,
    salonId: number,
    data: IndexedData,
    date: Date,
    gender?: string
  ): Promise<boolean> {
    // gender'ı geç ki fit-check süresi gerçek yerleştirme süresiyle AYNI olsun
    // (aksi halde gender-aware yerleştirme, gender-kör fit-check'i aşıp working
    // hours taşması / çakışma yaratabilir).
    const duration = this.calculateBlockDuration(block, staffId, data, gender);

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

    // 2. Check appointment conflicts (TAMPON dahil — gerçek temizlik süresi).
    // Her randevu staff zamanını [start, end + AÇIK tampon] kadar işgal eder; yeni
    // blok da [start, end + kendi açık tamponu]. Çakışma bu genişletilmiş ayak
    // izlerine göre. NOT: yalnız AÇIKÇA tanımlı tampon (bufferOverride / kategori
    // bufferMinutes) müşteriler-arası boşluk yaratır — implicit 15dk default'u
    // tüm salonlara dayatmıyoruz (tampon-yok salonda davranış aynı = 0 boşluk).
    const dateKey = localDateKey(date);
    const appointmentsKey = `${staffId}-${dateKey}`;
    const appointments = data.appointmentsByStaffAndDate.get(appointmentsKey) || [];

    const lastService = block.services[block.services.length - 1];
    const newTrailingBuffer = this.getExplicitBufferForServiceId(lastService?.id, data);
    const newOccupiedEnd = startTime + duration + newTrailingBuffer;

    for (const apt of appointments) {
      const aptStart = (apt.startTime.getHours() * 60) + apt.startTime.getMinutes();
      const aptEndRaw = (apt.endTime.getHours() * 60) + apt.endTime.getMinutes();
      const aptOccupiedEnd = aptEndRaw + this.getExplicitBufferForServiceId(apt.serviceId, data);

      // Check overlap of buffer-extended footprints
      if (startTime < aptOccupiedEnd && newOccupiedEnd > aptStart) {
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
    // Capacity semantics (2026-05-28 karar):
    //   - service.capacityOverride explicitly set → enforce as per-service
    //     concurrent cap across ALL staff (resource constraint, e.g. a
    //     single lazer machine).
    //   - else, category.capacity > 1 → enforce as per-category concurrent
    //     cap. category.capacity = 1 is the schema default and treated as
    //     "no explicit cap" (staff availability already enforced).
    //   - else → no global capacity check; staff conflict guard is enough.
    //
    // Effect: salon doesn't need to know about capacity to get correct
    // single-customer-per-staff behaviour; only an explicit number > 1
    // (or a service-level override) opts into a global resource limit.
    const dateKey = localDateKey(date);
    const blockEnd = startTime + duration;

    for (const service of block.services) {
      const category = service.categoryId ? data.categoriesById.get(service.categoryId) : undefined;

      let limit: number | null = null;
      let scope: 'service' | 'category' | null = null;
      if (service.capacityOverride !== null && service.capacityOverride !== undefined) {
        limit = service.capacityOverride;
        scope = 'service';
      } else if (category && category.capacity !== null && category.capacity > 1) {
        limit = category.capacity;
        scope = 'category';
      }

      if (limit === null || scope === null) {
        continue; // No explicit cap → rely on staff availability.
      }

      let concurrentCount = 0;
      for (const [key, appointments] of data.appointmentsByStaffAndDate.entries()) {
        if (!key.endsWith(dateKey)) continue;

        for (const apt of appointments) {
          const matchesScope =
            scope === 'service'
              ? apt.serviceId === service.id
              : (() => {
                  const aptService = data.servicesById.get(apt.serviceId);
                  return Boolean(aptService && aptService.categoryId === category!.id);
                })();
          if (!matchesScope) continue;

          const aptStart = apt.startTime.getHours() * 60 + apt.startTime.getMinutes();
          const aptEnd = apt.endTime.getHours() * 60 + apt.endTime.getMinutes();
          if (startTime < aptEnd && blockEnd > aptStart) {
            concurrentCount += 1;
          }
        }
      }

      if (concurrentCount >= limit) {
        return false;
      }
    }

    return true;
  }

  private calculateServiceDurations(block: ChainBlock, staffId: number, data: IndexedData, gender?: string): number[] {
    // Öncelik (fiyat resolver'ı servicePricing ile TUTARLI — Berkay kararı 2026-06-19):
    //   1. StaffService(staffId, gender)        — uzman + cinsiyet (en spesifik)
    //   2. ServiceVariant(gender)               — hizmet-seviyesi cinsiyet override'ı
    //   3. StaffService(staffId, herhangi)       — uzmanın genel satırı
    //   4. base Service.duration
    // Variant ARTIK staff-genel satırı EZER (eskiden rows[0] variant'ı yutuyordu →
    // katalog variant süresini gösterip booking staff-genel süresini kullanıyordu).
    return block.services.map((s) => {
      const rows = (data.staffServicesByService.get(s.id) || []).filter((ss) => ss.staffId === staffId);
      const gMatch = gender ? rows.find((r) => r.gender === gender) : undefined;
      if (gMatch) return gMatch.duration; // 1
      if (gender) {
        const variant = data.serviceVariantsByServiceAndGender.get(`${s.id}:${gender}`);
        if (variant) return variant.duration; // 2
      }
      if (rows[0]) return rows[0].duration; // 3
      return s.duration; // 4 (base)
    });
  }

  private calculateBlockDuration(block: ChainBlock, staffId: number, data: IndexedData, gender?: string): number {
    return this.calculateServiceDurations(block, staffId, data, gender).reduce((sum, d) => sum + d, 0);
  }

  private getBufferTime(block: ChainBlock, data: IndexedData): number {
    // Use the last service in the block to determine buffer
    const lastService = block.services[block.services.length - 1];
    const categoryBuffer = block.categoryId ? data.categoriesById.get(block.categoryId)?.bufferMinutes : null;
    return lastService.bufferOverride ?? categoryBuffer ?? 15;
  }

  // Müşteriler-ARASI temizlik tamponu (footprint rezervasyonu). getBufferTime'dan
  // FARKI: implicit 15dk default YOK → yalnız salonun AÇIKÇA tanımladığı tampon
  // (Service.bufferOverride veya ServiceCategory.bufferMinutes) boşluk yaratır.
  // Tanımsız (veya bloklu: serviceId<=0 closure/timeoff/lock) → 0 (davranış aynı).
  private getExplicitBufferForServiceId(serviceId: number | undefined, data: IndexedData): number {
    if (!serviceId || serviceId <= 0) return 0;
    const service = data.servicesById.get(serviceId);
    if (!service) return 0;
    if (service.bufferOverride !== null && service.bufferOverride !== undefined) return service.bufferOverride;
    const cat = service.categoryId ? data.categoriesById.get(service.categoryId) : undefined;
    if (cat && cat.bufferMinutes !== null && cat.bufferMinutes !== undefined) return cat.bufferMinutes;
    return 0;
  }
}
