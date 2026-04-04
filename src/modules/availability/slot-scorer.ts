import { ServiceChain } from './chain-builder.js';
import { DisplaySlot, GroupSlots, Slot, ServiceSlot } from './types.js';

export type SynchronizedSlot = {
  slots: ServiceChain[];
  parallelScore: number;
};

export class SlotScorer {
  private readonly DISPLAY_CLUSTER_MINUTES = 15;

  optimize(
    synchronized: SynchronizedSlot[],
    personIds: string[],
  ): { groups: GroupSlots[]; displaySlots: DisplaySlot[] } {
    const groupedByStart = new Map<number, SynchronizedSlot[]>();

    for (const sync of synchronized) {
      if (sync.slots.length === 0) continue;
      const earliestStart = Math.min(...sync.slots.map((slot) => slot.startTime));
      if (!groupedByStart.has(earliestStart)) {
        groupedByStart.set(earliestStart, []);
      }
      groupedByStart.get(earliestStart)!.push(sync);
    }

    const exactBestSlots = Array.from(groupedByStart.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, candidates]) => this.selectBestCombination(candidates));

    const resultSlots: Slot[][] = Array.from({ length: personIds.length }, () => []);
    for (const best of exactBestSlots) {
      for (let index = 0; index < personIds.length; index += 1) {
        const chain = best.slots[index];
        if (chain) {
          resultSlots[index].push(this.chainToSlot(chain));
        }
      }
    }

    const displaySlots = this.buildDisplaySlots(exactBestSlots, personIds);

    return {
      groups: personIds.map((personId, index) => ({
        personId,
        slots: resultSlots[index],
      })),
      displaySlots,
    };
  }

  private buildDisplaySlots(bestSlots: SynchronizedSlot[], personIds: string[]): DisplaySlot[] {
    const bucketed = new Map<number, SynchronizedSlot[]>();

    for (const candidate of bestSlots) {
      const candidateStart = Math.min(...candidate.slots.map((slot) => slot.startTime));
      const bucketStart = Math.floor(candidateStart / this.DISPLAY_CLUSTER_MINUTES) * this.DISPLAY_CLUSTER_MINUTES;
      if (!bucketed.has(bucketStart)) {
        bucketed.set(bucketStart, []);
      }
      bucketed.get(bucketStart)!.push(candidate);
    }

    return Array.from(bucketed.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, cluster]) => this.syncToDisplaySlot(this.selectBestCombination(cluster), personIds));
  }

  private syncToDisplaySlot(sync: SynchronizedSlot, personIds: string[]): DisplaySlot {
    const personSlots = sync.slots.map((chain, index) => {
      const slot = this.chainToSlot(chain);
      return {
        personId: personIds[index],
        slotKey: slot.slotKey,
        startTime: slot.startTime,
        endTime: slot.endTime,
        staffId: slot.staffId,
        serviceSequence: slot.serviceSequence,
      };
    });

    const startTimes = personSlots.map((slot) => this.parseMinutes(slot.startTime));
    const endTimes = personSlots.map((slot) => this.parseMinutes(slot.endTime));
    const earliestStart = Math.min(...startTimes);
    const latestEnd = Math.max(...endTimes);
    const displayStart = this.minutesToTime(earliestStart);
    const displayEnd = this.minutesToTime(latestEnd);

    return {
      displayKey: personSlots.map((slot) => `${slot.personId}:${slot.slotKey}`).join('|'),
      label: displayStart,
      startTime: displayStart,
      endTime: displayEnd,
      personSlots,
    };
  }

  private selectBestCombination(candidates: SynchronizedSlot[]): SynchronizedSlot {
    return [...candidates].sort((a, b) => {
      const personCount = a.slots.length;

      if (personCount >= 2) {
        const parallelDiff = b.parallelScore - a.parallelScore;
        if (Math.abs(parallelDiff) > 0.01) return parallelDiff;
      }

      const durationA = this.calculateTotalDuration(a.slots);
      const durationB = this.calculateTotalDuration(b.slots);
      const durationDiff = durationA - durationB;
      if (durationDiff !== 0) return durationDiff;

      const changesA = this.countTotalStaffChanges(a.slots);
      const changesB = this.countTotalStaffChanges(b.slots);
      const staffDiff = changesA - changesB;
      if (staffDiff !== 0) return staffDiff;

      return a.slots[0].startTime - b.slots[0].startTime;
    })[0];
  }

  private calculateTotalDuration(chains: ServiceChain[]): number {
    if (chains.length === 0) return 0;
    const start = Math.min(...chains.map((chain) => chain.startTime));
    const end = Math.max(...chains.map((chain) => chain.endTime));
    return end - start;
  }

  private countTotalStaffChanges(chains: ServiceChain[]): number {
    return chains.reduce((sum, chain) => sum + this.countChainStaffChanges(chain), 0);
  }

  private countChainStaffChanges(chain: ServiceChain): number {
    let changes = 0;
    for (let index = 1; index < chain.blocks.length; index += 1) {
      if (chain.blocks[index].staffId !== chain.blocks[index - 1].staffId) {
        changes += 1;
      }
    }
    return changes;
  }

  private chainToSlot(chain: ServiceChain): Slot {
    const serviceSequence: ServiceSlot[] = [];

    for (const block of chain.blocks) {
      let cursor = block.startTime;
      for (const service of block.block.services) {
        const start = cursor;
        const end = cursor + service.duration;
        serviceSequence.push({
          serviceId: service.id,
          start: this.minutesToTime(start),
          end: this.minutesToTime(end),
          staffId: block.staffId,
        });
        cursor = end;
      }
    }

    const slotKey = chain.blocks
      .map((block) => {
        const serviceIds = block.block.services.map((service) => service.id).join(',');
        return `${block.staffId}:${block.startTime}-${block.endTime}:${serviceIds}`;
      })
      .join('|');

    return {
      slotKey,
      startTime: this.minutesToTime(chain.startTime),
      endTime: this.minutesToTime(chain.endTime),
      staffId: chain.blocks[0]?.staffId || 0,
      serviceSequence,
    };
  }

  private minutesToTime(minutes: number): string {
    const safeMinutes = Math.max(0, minutes);
    const hour = Math.floor(safeMinutes / 60)
      .toString()
      .padStart(2, '0');
    const minute = (safeMinutes % 60).toString().padStart(2, '0');
    return `${hour}:${minute}`;
  }

  private parseMinutes(timeValue: string): number {
    const [hours, minutes] = timeValue.split(':').map((value) => Number(value));
    return (hours || 0) * 60 + (minutes || 0);
  }
}
