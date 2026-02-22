import { ServiceChain } from './chain-builder.js';
import { GroupSlots, Slot, ServiceSlot } from './types.js';

export type SynchronizedSlot = {
  slots: ServiceChain[];
  parallelScore: number;
};

export type OptimizedSlot = {
  startTime: number;
  endTime: number;
  chains: ServiceChain[];
};

export class SlotScorer {
  optimize(
    synchronized: SynchronizedSlot[],
    personIds: string[]
  ): GroupSlots[] {
    // Group by start time to find the best combination for each start time
    const groupedByStart = new Map<number, SynchronizedSlot[]>();

    for (const sync of synchronized) {
      // Use the start time of the first person (anchor) as the key
      // Or maybe the earliest start time across all people?
      // Let's use the anchor (first person) start time as the primary grouping key
      // since that's how we iterate.
      // Actually, for the UI, we want to show slots based on when the *booking* starts.
      // Usually that's the earliest start time.
      if (sync.slots.length === 0) continue;

      const earliestStart = Math.min(...sync.slots.map(s => s.startTime));
      
      if (!groupedByStart.has(earliestStart)) {
        groupedByStart.set(earliestStart, []);
      }
      groupedByStart.get(earliestStart)!.push(sync);
    }

    const resultSlots: Slot[][] = Array(personIds.length).fill([]).map(() => []);
    
    // For each start time, pick the BEST combination
    const sortedStartTimes = Array.from(groupedByStart.keys()).sort((a, b) => a - b);

    for (const startTime of sortedStartTimes) {
      const candidates = groupedByStart.get(startTime)!;
      const best = this.selectBestCombination(candidates);

      // Add to result
      for (let i = 0; i < personIds.length; i++) {
        const chain = best.slots[i];
        if (chain) {
          resultSlots[i].push(this.chainToSlot(chain));
        }
      }
    }
    
    // Construct final GroupSlots
    return personIds.map((personId, index) => ({
      personId,
      slots: resultSlots[index]
    }));
  }

  private selectBestCombination(candidates: SynchronizedSlot[]): SynchronizedSlot {
    return candidates.sort((a, b) => {
      const personCount = a.slots.length;
      
      if (personCount >= 2) {
        // 1. Parallelism (higher is better)
        const parallelDiff = b.parallelScore - a.parallelScore;
        if (Math.abs(parallelDiff) > 0.01) return parallelDiff;
      }
      
      // 2. Total Duration (shorter is better)
      const durationA = this.calculateTotalDuration(a.slots);
      const durationB = this.calculateTotalDuration(b.slots);
      const durationDiff = durationA - durationB;
      if (durationDiff !== 0) return durationDiff;
      
      // 3. Staff Changes (fewer is better)
      const changesA = this.countTotalStaffChanges(a.slots);
      const changesB = this.countTotalStaffChanges(b.slots);
      const staffDiff = changesA - changesB;
      if (staffDiff !== 0) return staffDiff;
      
      // 4. Deterministic tie-break (start time of first person)
      return a.slots[0].startTime - b.slots[0].startTime;
    })[0];
  }

  private calculateTotalDuration(chains: ServiceChain[]): number {
    if (chains.length === 0) return 0;
    const start = Math.min(...chains.map(c => c.startTime));
    const end = Math.max(...chains.map(c => c.endTime));
    return end - start;
  }

  private countTotalStaffChanges(chains: ServiceChain[]): number {
    return chains.reduce((sum, chain) => sum + this.countChainStaffChanges(chain), 0);
  }

  private countChainStaffChanges(chain: ServiceChain): number {
    let changes = 0;
    for (let i = 1; i < chain.blocks.length; i++) {
      if (chain.blocks[i].staffId !== chain.blocks[i - 1].staffId) {
        changes++;
      }
    }
    return changes;
  }

  private chainToSlot(chain: ServiceChain): Slot {
    const startHour = Math.floor(chain.startTime / 60).toString().padStart(2, '0');
    const startMin = (chain.startTime % 60).toString().padStart(2, '0');
    
    const endHour = Math.floor(chain.endTime / 60).toString().padStart(2, '0');
    const endMin = (chain.endTime % 60).toString().padStart(2, '0');
    
    return {
      startTime: `${startHour}:${startMin}`,
      endTime: `${endHour}:${endMin}`,
      staffId: chain.blocks[0].staffId, // Main staff is usually the first one
      serviceSequence: chain.blocks.flatMap(b => 
        b.block.services.map(s => {
          // Note: Start/End times for individual services within a block need calculation
          // if we want precise per-service times. 
          // For now, let's simplify or if needed, calculate them.
          // The block has a startTime and duration.
          // Services within a sequential block run back-to-back.
          return {
             serviceId: s.id,
             start: "00:00", // Placeholder - precise calculation requires iterating services in block
             end: "00:00"
          };
        })
      ).map((s, idx, arr) => {
          // Let's refine the times. We need to iterate blocks and services properly.
          return s;
      }) 
    };
  }
}
