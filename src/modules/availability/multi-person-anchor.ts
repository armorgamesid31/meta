import { ServiceChain } from './chain-builder.js';
import { PersonGroup, IndexedData, AvailabilityRequest } from './types.js';
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
    const [firstGroup, ...otherGroups] = request.groups;
    
    // 1. Generate slots for the first person (anchor)
    const firstPersonSlots = await this.slotsEngine.generateSlotsForGroup(firstGroup, date, data);
    
    if (firstPersonSlots.length === 0) return [];
    
    // If only one person, return their slots wrapped as synchronized
    if (otherGroups.length === 0) {
      return firstPersonSlots.map(slot => ({
        slots: [slot],
        parallelScore: 0
      }));
    }

    const synchronized: SynchronizedSlot[] = [];
    
    // 2. Try to find compatible slots for other groups around each anchor slot
    // Optimization: Sort anchors to try best times first? Not necessarily.
    
    for (const anchorSlot of firstPersonSlots) {
      // STRICT HARD LIMIT CHECK
      if (synchronized.length >= maxCombinations) break;

      const combinations = await this.tryOtherGroups(
        anchorSlot,
        otherGroups,
        date,
        data,
        maxCombinations - synchronized.length
      );
      
      synchronized.push(...combinations);
    }

    // Post-generation pruning if we exceeded (though the checks above should prevent it)
    if (synchronized.length > maxCombinations) {
        synchronized.length = maxCombinations;
    }
    
    return synchronized;
  }
  
  private async tryOtherGroups(
    anchorSlot: ServiceChain,
    otherGroups: PersonGroup[],
    date: Date,
    data: IndexedData,
    remainingLimit: number
  ): Promise<SynchronizedSlot[]> {
    const results: SynchronizedSlot[] = [];
    
    // Recursive search for combinations
    await this.buildCombinations(
      [anchorSlot],
      otherGroups,
      date,
      data,
      results,
      remainingLimit
    );
    
    return results;
  }
  
  private async buildCombinations(
    currentSlots: ServiceChain[],
    remainingGroups: PersonGroup[],
    date: Date,
    data: IndexedData,
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
    const previousSlot = currentSlots[currentSlots.length - 1];
    
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
    
    // Let's define the search window for Next Group based on Current Slots.
    // We want the group to be "together".
    // Let's search for NextGroup slots that start in [MinStart, MaxStart].
    // MaxStart = Math.max(...currentSlots.map(s => s.endTime)) + 15.
    // MinStart = Math.min(...currentSlots.map(s => s.startTime)) - 15? (Allow starting slightly earlier?)
    
    // To be efficient, let's use the anchor (first person) as the reference for "general time area".
    const anchor = currentSlots[0];
    const maxStart = anchor.endTime + 15;
    const minStart = anchor.startTime - 60; // optimization: don't look too far back
    
    // However, the constraint is pairwise or global?
    // "Bir kişinin randevusu bittiğinde diğer kişi en geç 15 dakika içinde başlamalı."
    // Usually implies pairwise sequential chain or cluster.
    
    // Let's simply generate VALID slots for NextGroup that satisfy the constraint against AT LEAST ONE existing slot?
    // Or against the Anchor?
    
    // Let's generate ALL slots for NextGroup on this date (cached/optimized) and filter.
    // Actually, `slotsEngine.generateSlotsForGroup` generates all valid slots for a group.
    const nextGroupSlots = await this.slotsEngine.generateSlotsForGroup(nextGroup, date, data);
    
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
        
        if (nextSlot.startTime <= anchor.endTime + 15 && nextSlot.startTime >= anchor.startTime - 30) {
             // Also check for staff conflicts between people!
             // "Aynı staff aynı anda iki kişiye atanamaz."
             if (!this.hasStaffConflict(nextSlot, currentSlots)) {
                 await this.buildCombinations(
                     [...currentSlots, nextSlot],
                     restGroups,
                     date,
                     data,
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
