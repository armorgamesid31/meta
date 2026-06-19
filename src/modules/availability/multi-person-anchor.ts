import { ServiceChain } from './chain-builder.js';
import { PersonGroup, IndexedData, AvailabilityRequest, getGroupServiceIds } from './types.js';
import { SlotsEngine } from './slots-engine.js';
import { SynchronizedSlot } from './slot-scorer.js';

export class MultiPersonAnchor {
  constructor(private slotsEngine: SlotsEngine) {}

  async synchronizeGroups(
    request: AvailabilityRequest,
    date: Date,
    data: IndexedData,
    maxCombinations: number
  ): Promise<SynchronizedSlot[]> {
    // Pick the group with the largest estimated total duration as the
    // anchor — bigger blocks have fewer valid positions, so iterating
    // them first prunes the combination space dramatically (bavula
    // büyükleri önce yerleştir).
    // We sort internally but restore the original groups order on output
    // so slot-scorer (which keys on request.groups[i].personId) sees
    // chains in the expected positions.
    const sortedWithIndex = request.groups
      .map((group, originalIndex) => ({
        group,
        originalIndex,
        estimatedDuration: this.estimateGroupDuration(group, data),
      }))
      .sort((a, b) => b.estimatedDuration - a.estimatedDuration);
    const sortedGroups = sortedWithIndex.map((entry) => entry.group);
    const originalIndices = sortedWithIndex.map((entry) => entry.originalIndex);

    const [firstGroup, ...otherGroups] = sortedGroups;

    // 1. Generate slots for the anchor person.
    const firstPersonSlots = await this.slotsEngine.generateSlotsForGroup(firstGroup, date, data);

    if (firstPersonSlots.length === 0) return [];

    // If only one person, return their slots wrapped as synchronized.
    if (otherGroups.length === 0) {
      return firstPersonSlots.map((slot) => ({
        slots: [slot],
        parallelScore: 0,
      }));
    }

    // #1: her DİĞER grubun slotlarını BİR KEZ hesapla. Eskiden buildCombinations
    // her anchor slotu × her recursion seviyesinde generateSlotsForGroup'u tekrar
    // çağırıyordu (O(anchor×grup) pahalı yeniden hesaplama). Bir grubun slotları
    // anchor'dan bağımsızdır (yalnız kendi kısıtları) → güvenle memoize edilir.
    const slotsByPersonId = new Map<string, ServiceChain[]>();
    for (const g of otherGroups) {
      slotsByPersonId.set(g.personId, await this.slotsEngine.generateSlotsForGroup(g, date, data));
    }

    const synchronized: SynchronizedSlot[] = [];

    // Her anchor için EN FAZLA 1 kombinasyon al. Aksi halde tek bir anchor (5dk
    // granülerlikte ~100+ slot) kişi-2'nin onlarca cohesive seçeneğiyle budget'i
    // (maxCombinations) sabah anchor'larında tüketiyordu → öğleden sonra hiç
    // işlenmiyordu (2 kişilik ağda 09:00-11:00'da kesiliyordu — Berkay bug'ı).
    // Bir anchor başlangıcının "müsait" işaretlenmesi için 1 geçerli düzen yeter;
    // slot-scorer aynı görsel saate düşen anchor'lar arasından en iyisini seçer.
    for (const anchorSlot of firstPersonSlots) {
      if (synchronized.length >= maxCombinations) break;

      const combinations = await this.tryOtherGroups(
        anchorSlot,
        otherGroups,
        slotsByPersonId,
        date,
        data,
        1,
      );

      synchronized.push(...combinations);
    }

    if (synchronized.length > maxCombinations) {
      synchronized.length = maxCombinations;
    }

    // Restore original groups order so downstream code (slot-scorer)
    // can index by request.groups[i].personId.
    return synchronized.map((sync) => ({
      ...sync,
      slots: this.reorderSlotsToOriginal(sync.slots, originalIndices),
    }));
  }

  private estimateGroupDuration(group: PersonGroup, data: IndexedData): number {
    // Anchor-pick heuristic only — doesn't need to be exact. Uses
    // gender variant when present, otherwise WORST-CASE: all variants'in
    // MAX duration'ı (audit [HIGH]) — gender undefined iken base duration
    // kullanmak suboptimal anchor seçimine yol açıyordu, female 90dk +
    // male 60dk varyant olan bir hizmette base 75dk anchor pencerelerini
    // dar sayar. Worst-case alarak anchor over-allocates → güvenli.
    // Per-staff overrides skipped here, staff assignment henüz belli değil.
    let total = 0;
    for (const serviceId of getGroupServiceIds(group)) {
      const service = data.servicesById.get(serviceId);
      if (!service) continue;
      let estimatedDuration: number;
      if (group.gender) {
        const variant = data.serviceVariantsByServiceAndGender.get(`${serviceId}:${group.gender}`);
        estimatedDuration = variant?.duration ?? service.duration;
      } else {
        // Gender bilinmiyor — tüm variant'lar arasından MAX'ı al, base ile
        // karşılaştır, hangisi büyükse onu kullan. Bu sayede anchor "yeterli
        // pencere yok" diye yanlış elemez.
        const femaleVariant = data.serviceVariantsByServiceAndGender.get(`${serviceId}:female`);
        const maleVariant = data.serviceVariantsByServiceAndGender.get(`${serviceId}:male`);
        estimatedDuration = Math.max(
          service.duration,
          femaleVariant?.duration ?? 0,
          maleVariant?.duration ?? 0,
        );
      }
      total += estimatedDuration;
    }
    return total;
  }

  private reorderSlotsToOriginal(slots: ServiceChain[], originalIndices: number[]): ServiceChain[] {
    const result: ServiceChain[] = new Array(slots.length);
    for (let sortedIdx = 0; sortedIdx < slots.length; sortedIdx += 1) {
      const originalIdx = originalIndices[sortedIdx];
      result[originalIdx] = slots[sortedIdx];
    }
    return result;
  }
  
  private async tryOtherGroups(
    anchorSlot: ServiceChain,
    otherGroups: PersonGroup[],
    slotsByPersonId: Map<string, ServiceChain[]>,
    date: Date,
    data: IndexedData,
    remainingLimit: number
  ): Promise<SynchronizedSlot[]> {
    const results: SynchronizedSlot[] = [];

    // Recursive search for combinations
    await this.buildCombinations(
      [anchorSlot],
      otherGroups,
      slotsByPersonId,
      results,
      remainingLimit
    );

    return results;
  }

  private async buildCombinations(
    currentSlots: ServiceChain[],
    remainingGroups: PersonGroup[],
    slotsByPersonId: Map<string, ServiceChain[]>,
    results: SynchronizedSlot[],
    limit: number
  ): Promise<void> {
    if (results.length >= limit) return;

    if (remainingGroups.length === 0) {
      results.push({
        slots: [...currentSlots],
        parallelScore: this.calculateParallelScore(currentSlots)
      });
      return;
    }
    
    const [nextGroup, ...restGroups] = remainingGroups;
    
    // Constraint: Next person starts after previous person ends (within 15 min gap window?)
    // Requirement: "Bir kişinin bitişi +15dk ≥ diğerinin başlangıcı"
    // Wait, the requirement was "Bir kişinin bitişi +15dk >= diğerinin başlangıcı" which implies
    // synchronization. It usually means they shouldn't start TOO late after the previous one finishes.
    // Or maybe "Start time constraint"?
    // "Bir kişinin randevusu bittiğinde diğer kişi en geç 15 dakika içinde başlamalı."
    // So: NextPerson.Start <= PrevPerson.End + 15 min.
    // Also, usually they shouldn't start BEFORE previous person finishes?
    // "Aynı anda başlamak ideal ama zorunlu değil." -> So they CAN start earlier (parallel).
    // "Başlangıç saatleri değil, bitişe göre senkronizasyon önemli."
    
    // Let's interpret:
    // Ideally parallel.
    // If sequential, gap <= 15 min.
    
    // Wait, if they are parallel, does "bitişi + 15 >= başlangıcı" make sense?
    // If Person A: 10:00-11:00. Person B: 10:00-11:00.
    // A.End = 11:00. B.Start = 10:00.
    // 11:00 + 15 >= 10:00. True.
    
    // If Person A: 10:00-11:00. Person B: 12:00-13:00.
    // A.End = 11:00. B.Start = 12:00.
    // 11:00 + 15 >= 12:00. False (11:15 < 12:00).
    
    // So the constraint allows parallel and slightly sequential, but prevents big gaps.
    // Constraint: Next.Start <= Prev.End + 15 minutes.
    
    // Also, we need to respect "Start >= Prev.Start"?
    // "Aynı anda başlamak ideal".
    // Usually in multi-person bookings, we iterate based on "anchor".
    // We try to find slots for NextGroup such that they align with Anchor.
    
    // To avoid explosion, we should limit the search range for NextGroup.
    // Range: 
    // Min Start: Anchor.Start (or maybe earlier? usually we sort people, so assume Next starts >= Anchor.Start?)
    // Let's assume we sort groups or just try to fit.
    // If we assume Next starts >= Anchor.Start (to avoid duplicate combinations if we permute groups),
    // Max Start: Anchor.End + 15 min.
    
    // Wait, if we enforce order Person 1, Person 2...
    // We should look for Person 2 slots that start roughly around Person 1.
    // Valid Start Range for Person 2:
    // [Person1.Start - 15?, Person1.End + 15] ??
    
    // The requirement "Bir kişinin bitişi +15dk >= diğerinin başlangıcı" is key.
    // It's a "Max Gap" constraint.
    
    // #3 (Berkay kararı "çakışma yeterli"): yeni kişi, ŞU ANA KADAR yerleşmiş
    // TÜM kişilerin (sadece ilk kişi/anchor DEĞİL — küme) zaman aralığıyla
    // çakışmalı ya da en fazla 15dk boşlukla yakın olmalı. Eski kod sadece
    // anchor'a (ilk kişi) bakıyordu → 3+ kişide 2. ve 3. kişi birbirinden uzak
    // düşebiliyor ve anchor uzun hizmet alıyorsa pencere şişip kayıyordu.
    // Küme aralığı = tüm yerleşmiş slotların min başlangıç / max bitiş (dakika).
    const clusterStart = Math.min(...currentSlots.map((s) => s.startTime));
    const clusterEnd = Math.max(...currentSlots.map((s) => s.endTime));
    
    // However, the constraint is pairwise or global?
    // "Bir kişinin randevusu bittiğinde diğer kişi en geç 15 dakika içinde başlamalı."
    // Usually implies pairwise sequential chain or cluster.
    
    // Let's simply generate VALID slots for NextGroup that satisfy the constraint against AT LEAST ONE existing slot?
    // Or against the Anchor?
    
    // #1: bu grubun slotları synchronizeGroups'ta BİR KEZ hesaplandı (memoize).
    const nextGroupSlots = slotsByPersonId.get(nextGroup.personId) || [];
    
    for (const nextSlot of nextGroupSlots) {
        if (results.length >= limit) return;

        // Check constraint against the anchor (or strictly previous person?)
        // If "Sequence" matters (Person 1 then Person 2), we check against Person 1.
        // If it's a cluster, we check if it fits in the cluster.
        
        // Let's check against ALL current slots to ensure "cohesion".
        // Ensure this new slot is "close enough" to the existing group.
        // Rule: Must start no later than (EarliestEnd + 15) ?
        // Or "Any person's end + 15 >= This start"?
        
        // Let's use the requirement strictly:
        // "Bir kişinin randevusu bittiğinde diğer kişi en geç 15 dakika içinde başlamalı."
        // implies that if they are sequential, the gap is small.
        // If they are parallel, it's satisfied.
        
        // Let's check against the Anchor (first person) for simplicity and stability.
        // Anchor.End + 15 >= Next.Start.
        // AND Next.End + 15 >= Anchor.Start (symmetry? so anchor isn't too far ahead?)
        
        // Let's stick to: Next.Start <= Anchor.End + 15.
        // And also Next.Start >= Anchor.Start - 30 (heuristic to keep them close).
        
        // Küme-bazlı çakışma: yeni slot kümeyle çakışsın ya da ≤15dk yakın olsun.
        // (Sonradan başlıyorsa kümenin bitişinden ≤15dk sonra; önce bitiyorsa
        // kümenin başlangıcından ≤15dk önce başlasın.)
        const cohesive = nextSlot.startTime <= clusterEnd + 15 && nextSlot.endTime >= clusterStart - 15;
        if (cohesive) {
             // Aynı staff aynı anda iki kişiye atanamaz.
             if (!this.hasStaffConflict(nextSlot, currentSlots)) {
                 await this.buildCombinations(
                     [...currentSlots, nextSlot],
                     restGroups,
                     slotsByPersonId,
                     results,
                     limit
                 );
             }
        }
    }
  }
  
  private hasStaffConflict(newSlot: ServiceChain, existingSlots: ServiceChain[]): boolean {
      for (const existing of existingSlots) {
          // Check if any block overlaps with same staff
          for (const newBlock of newSlot.blocks) {
              for (const existingBlock of existing.blocks) {
                  if (newBlock.staffId === existingBlock.staffId) {
                      // Check time overlap
                      if (newBlock.startTime < existingBlock.endTime && newBlock.endTime > existingBlock.startTime) {
                          return true;
                      }
                  }
              }
          }
      }
      return false;
  }
  
  private calculateParallelScore(slots: ServiceChain[]): number {
    if (slots.length < 2) return 0;
    
    const minStart = Math.min(...slots.map(s => s.startTime));
    const maxEnd = Math.max(...slots.map(s => s.endTime));
    const totalDuration = maxEnd - minStart;
    
    if (totalDuration === 0) return 0;

    // Calculate overlap
    // Simple metric: Sum of overlaps between all pairs?
    // Or "Time where at least 2 people are present" / Total Duration?
    
    // Let's use: (Sum of durations - Total Duration) / Sum of durations? No.
    // Metric: overlapDuration / totalDuration.
    
    // Let's find time intervals where count >= 2.
    const timePoints = new Set<number>();
    slots.forEach(s => {
        timePoints.add(s.startTime);
        timePoints.add(s.endTime);
    });
    const sortedPoints = Array.from(timePoints).sort((a, b) => a - b);
    
    let overlapDuration = 0;
    
    for (let i = 0; i < sortedPoints.length - 1; i++) {
        const start = sortedPoints[i];
        const end = sortedPoints[i+1];
        const mid = (start + end) / 2;
        
        let activeCount = 0;
        for (const slot of slots) {
            if (slot.startTime <= start && slot.endTime >= end) {
                activeCount++;
            }
        }
        
        if (activeCount >= 2) {
            overlapDuration += (end - start);
        }
    }
    
    return overlapDuration / totalDuration;
  }
}
