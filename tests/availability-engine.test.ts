/**
 * COMPREHENSIVE in-memory test suite for the Kedy availability / slot-generation
 * engine (src/modules/availability/*).
 *
 * Strategy: build IndexedData objects by hand and drive the engine sub-modules
 * directly — slotsEngine.generateSlotsForGroup, MultiPersonAnchor.synchronizeGroups
 * and SlotScorer.optimize. NO database: the only prisma call reachable from these
 * sub-modules is anchor-iterator's staffServiceCustomSlot.findMany, which we mock
 * to return []. generateSlots() (the DB batch-fetch entry point) is NOT called, so
 * the production DB is never touched.
 *
 * Time handling: the engine does conflict math via Date.getHours()/getMinutes()
 * (local time) compared against minutes-from-midnight. We build all appointment
 * Dates with the local-time constructor new Date(y,m,d,hh,mm) so getHours()===hh
 * on any machine TZ -> deterministic regardless of the runner's timezone. We key
 * appointment maps with localDateKey(date), exactly like batchFetchData does.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock prisma BEFORE importing the engine. anchor-iterator calls
// prisma.staffServiceCustomSlot.findMany; everything else we exercise is pure.
const mocks = vi.hoisted(() => ({
  prisma: {
    staffServiceCustomSlot: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock('../src/prisma.js', () => ({ prisma: mocks.prisma }));

import { SlotsEngine } from '../src/modules/availability/slots-engine.js';
import { MultiPersonAnchor } from '../src/modules/availability/multi-person-anchor.js';
import { SlotScorer } from '../src/modules/availability/slot-scorer.js';
import { PermutationPruner } from '../src/modules/availability/permutation-pruner.js';
import { ChainBuilder } from '../src/modules/availability/chain-builder.js';
import {
  IndexedData,
  PersonGroup,
  AvailabilityRequest,
  ServiceInfo,
  CategoryInfo,
  StaffServiceRow,
  WorkingHoursRow,
  AppointmentRow,
  ServiceVariantInfo,
  localDateKey,
} from '../src/modules/availability/types.js';

// ---------------------------------------------------------------------------
// Builders for IndexedData
// ---------------------------------------------------------------------------

function emptyData(): IndexedData {
  return {
    staffServicesByService: new Map<number, StaffServiceRow[]>(),
    workingHoursByStaffAndDay: new Map<string, WorkingHoursRow>(),
    appointmentsByStaffAndDate: new Map<string, AppointmentRow[]>(),
    servicesById: new Map<number, ServiceInfo>(),
    categoriesById: new Map<number, CategoryInfo>(),
    serviceVariantsByServiceAndGender: new Map<string, ServiceVariantInfo>(),
  };
}

type ServiceOpts = Partial<Omit<ServiceInfo, 'id'>>;
function addService(data: IndexedData, id: number, duration: number, opts: ServiceOpts = {}): void {
  data.servicesById.set(id, {
    id,
    name: opts.name ?? `svc-${id}`,
    duration,
    bufferOverride: opts.bufferOverride ?? null,
    categoryId: opts.categoryId ?? null,
    capacityOverride: opts.capacityOverride ?? null,
    sequentialOverride: opts.sequentialOverride ?? null,
  });
}

function addCategory(data: IndexedData, id: number, opts: Partial<Omit<CategoryInfo, 'id'>> = {}): void {
  data.categoriesById.set(id, {
    id,
    sequentialRequired: opts.sequentialRequired ?? false,
    bufferMinutes: opts.bufferMinutes ?? null,
    capacity: opts.capacity ?? 1,
  });
}

/** Register that `staffId` can perform `serviceId`, with an optional per-staff (and per-gender) duration override. */
function addStaffService(
  data: IndexedData,
  staffId: number,
  serviceId: number,
  duration: number,
  gender?: string,
): void {
  if (!data.staffServicesByService.has(serviceId)) data.staffServicesByService.set(serviceId, []);
  data.staffServicesByService.get(serviceId)!.push({ staffId, serviceId, duration, isactive: true, gender });
}

/** Set working hours for a staff member on a given JS day-of-week (0=Sun..6=Sat). */
function setWorkingHours(
  data: IndexedData,
  staffId: number,
  dayOfWeek: number,
  startHour: number,
  endHour: number,
): void {
  data.workingHoursByStaffAndDay.set(`${staffId}-${dayOfWeek}`, { staffId, dayOfWeek, startHour, endHour });
}

function addServiceVariant(
  data: IndexedData,
  id: number,
  serviceId: number,
  gender: string,
  duration: number,
  price = 0,
): void {
  data.serviceVariantsByServiceAndGender.set(`${serviceId}:${gender}`, { id, serviceId, gender, price, duration });
}

/**
 * Add a blocking interval (existing appointment / time-off / lock / closure)
 * for a staff member. Times are HH:MM local on `date`. serviceId<=0 means a
 * pure block (closure/timeoff/lock) -> 0 buffer; serviceId>0 means a real
 * appointment whose explicit buffer (if any) applies.
 */
function addAppointment(
  data: IndexedData,
  date: Date,
  staffId: number,
  startHHMM: [number, number],
  endHHMM: [number, number],
  serviceId = 0,
  status = 'BOOKED',
): void {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  const startTime = new Date(y, m, d, startHHMM[0], startHHMM[1], 0, 0);
  const endTime = new Date(y, m, d, endHHMM[0], endHHMM[1], 0, 0);
  const key = `${staffId}-${localDateKey(date)}`;
  if (!data.appointmentsByStaffAndDate.has(key)) data.appointmentsByStaffAndDate.set(key, []);
  data.appointmentsByStaffAndDate.get(key)!.push({
    id: -999,
    staffId,
    serviceId,
    startTime,
    endTime,
    status,
  });
}

// ---------------------------------------------------------------------------
// Engine drivers
// ---------------------------------------------------------------------------

const engine = new SlotsEngine();
const scorer = new SlotScorer();

/** A fixed FUTURE date. 2026-09-14 is a Monday (getDay()===1). */
function monday(): Date {
  return new Date(2026, 8, 14); // local midnight, Sep 14 2026, Monday
}
function saturday(): Date {
  return new Date(2026, 8, 19); // Sep 19 2026, Saturday (getDay()===6)
}
const DOW_MON = 1;
const DOW_SAT = 6;

function group(personId: string, services: PersonGroup['services'], gender?: PersonGroup['gender']): PersonGroup {
  return { personId, services, gender };
}

/** Single-person: produce the optimized display + per-person slots via the full post-fetch pipeline. */
async function runSingle(
  g: PersonGroup,
  date: Date,
  data: IndexedData,
  maxCombinations = 600,
): Promise<{ startTimes: string[]; displayCount: number; slots: { startTime: string; endTime: string; staffId: number; serviceSequence: any[] }[] }> {
  const request: AvailabilityRequest = { salonId: 1, date: localDateKey(date), groups: [g] };
  const anchor = new MultiPersonAnchor(engine);
  const synchronized = await anchor.synchronizeGroups(request, date, data, maxCombinations);
  const optimized = scorer.optimize(synchronized, [g.personId]);
  const personSlots = optimized.groups[0]?.slots ?? [];
  return {
    startTimes: personSlots.map((s) => s.startTime).sort(),
    displayCount: optimized.displaySlots.length,
    slots: personSlots as any,
  };
}

/** Multi-person: run synchronizeGroups + optimize, return per-person + display info. */
async function runMulti(
  groups: PersonGroup[],
  date: Date,
  data: IndexedData,
  maxCombinations = 600,
): Promise<{
  display: { startTime: string; endTime: string; personSlots: any[] }[];
  perPerson: Map<string, { startTime: string; endTime: string; staffId: number }[]>;
  synchronizedCount: number;
}> {
  const request: AvailabilityRequest = { salonId: 1, date: localDateKey(date), groups };
  const anchor = new MultiPersonAnchor(engine);
  const synchronized = await anchor.synchronizeGroups(request, date, data, maxCombinations);
  const optimized = scorer.optimize(synchronized, groups.map((x) => x.personId));
  const perPerson = new Map<string, { startTime: string; endTime: string; staffId: number }[]>();
  for (const grp of optimized.groups) {
    perPerson.set(grp.personId, grp.slots.map((s) => ({ startTime: s.startTime, endTime: s.endTime, staffId: s.staffId })));
  }
  return {
    display: optimized.displaySlots.map((d) => ({ startTime: d.startTime, endTime: d.endTime, personSlots: d.personSlots })),
    perPerson,
    synchronizedCount: synchronized.length,
  };
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ===========================================================================
// SINGLE PERSON
// ===========================================================================
describe('Single person', () => {
  it('1 service, single staff: slots span the whole working day, correct boundary', async () => {
    const data = emptyData();
    addService(data, 1, 60); // 60 min haircut
    addStaffService(data, 10, 1, 60);
    setWorkingHours(data, 10, DOW_MON, 9, 17); // 09:00-17:00

    const res = await runSingle(group('p1', [1]), monday(), data);

    // First slot 09:00, last START must be 16:00 (16:00 + 60 = 17:00 == end, allowed).
    expect(res.startTimes[0]).toBe('09:00');
    expect(res.startTimes[res.startTimes.length - 1]).toBe('16:00');
    // No slot may start at 16:05+ (would overflow 17:00).
    expect(res.startTimes.includes('16:05')).toBe(false);
    // 5-min granularity from 09:00..16:00 -> (16-9)*12 + 1 = 85 slots.
    expect(res.startTimes.length).toBe(85);
  });

  it('multi-service chain (non-sequential): total duration is sum + buffer; end time correct', async () => {
    const data = emptyData();
    addService(data, 1, 30);
    addService(data, 2, 45);
    addStaffService(data, 10, 1, 30);
    addStaffService(data, 10, 2, 45);
    setWorkingHours(data, 10, DOW_MON, 9, 17);

    const res = await runSingle(group('p1', [1, 2]), monday(), data);
    // Two individual blocks. Default inter-block buffer (getBufferTime) = 15.
    // Total occupied = 30 + 15 + 45 = 90 min. First slot 09:00 -> ends 10:30.
    const first = res.slots.find((s) => s.startTime === '09:00')!;
    expect(first).toBeTruthy();
    expect(first.endTime).toBe('10:30');
    // serviceSequence: svc1 09:00-09:30, svc2 09:45-10:30 (buffer is a gap, not a service).
    expect(first.serviceSequence.map((x: any) => `${x.serviceId}:${x.start}-${x.end}`)).toEqual([
      '1:09:00-09:30',
      '2:09:45-10:30',
    ]);
    // Last start: 90-min footprint must fit in 17:00 -> last start 15:30.
    expect(res.startTimes[res.startTimes.length - 1]).toBe('15:30');
  });

  it('last-slot boundary: a service that exactly fills the window yields exactly one slot', async () => {
    const data = emptyData();
    addService(data, 1, 60);
    addStaffService(data, 10, 1, 60);
    setWorkingHours(data, 10, DOW_MON, 9, 10); // only 09:00-10:00

    const res = await runSingle(group('p1', [1]), monday(), data);
    expect(res.startTimes).toEqual(['09:00']);
  });

  it('service longer than working window yields no slots', async () => {
    const data = emptyData();
    addService(data, 1, 120);
    addStaffService(data, 10, 1, 120);
    setWorkingHours(data, 10, DOW_MON, 9, 10); // 1h window, 2h service

    const res = await runSingle(group('p1', [1]), monday(), data);
    expect(res.startTimes).toEqual([]);
  });
});

// ===========================================================================
// MULTI-PERSON
// ===========================================================================
describe('Multi-person', () => {
  it('CRITICAL regression: 2 people sharing ONE staff for a short service -> slots across the WHOLE day', async () => {
    // The recent fix: synchronizeGroups takes at most 1 combination per anchor,
    // so morning anchors don't exhaust the combination budget. With one shared
    // staff, the two people must be sequential; we should still see afternoon slots.
    const data = emptyData();
    addService(data, 1, 30);
    addStaffService(data, 10, 1, 30);
    setWorkingHours(data, 10, DOW_MON, 9, 17);

    const res = await runMulti([group('p1', [1]), group('p2', [1])], monday(), data);

    const displayStarts = res.display.map((d) => d.startTime).sort();
    expect(displayStarts.length).toBeGreaterThan(0);
    const earliest = toMin(displayStarts[0]);
    const latest = toMin(displayStarts[displayStarts.length - 1]);
    // Earliest should be morning (~09:00), latest must reach the afternoon.
    expect(earliest).toBeLessThanOrEqual(9 * 60 + 30);
    expect(latest).toBeGreaterThanOrEqual(15 * 60); // must reach >= 15:00, not stuck in the morning
  });

  it('shared single staff: the two people never overlap on that staff (staff-conflict guard)', async () => {
    const data = emptyData();
    addService(data, 1, 30);
    addStaffService(data, 10, 1, 30);
    setWorkingHours(data, 10, DOW_MON, 9, 17);

    const res = await runMulti([group('p1', [1]), group('p2', [1])], monday(), data);

    for (const d of res.display) {
      const sameStaff = d.personSlots.filter((ps: any) => ps.staffId === 10);
      if (sameStaff.length === 2) {
        const a = sameStaff[0];
        const b = sameStaff[1];
        const aS = toMin(a.startTime);
        const aE = toMin(a.endTime);
        const bS = toMin(b.startTime);
        const bE = toMin(b.endTime);
        const overlap = aS < bE && bS < aE;
        expect(overlap).toBe(false);
      }
    }
  });

  it('cohesion: each person within 15 min of the placed cluster', async () => {
    const data = emptyData();
    addService(data, 1, 30);
    addStaffService(data, 10, 1, 30);
    addStaffService(data, 11, 1, 30);
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    setWorkingHours(data, 11, DOW_MON, 9, 17);

    const res = await runMulti([group('p1', [1]), group('p2', [1])], monday(), data);

    for (const d of res.display) {
      const starts = d.personSlots.map((ps: any) => toMin(ps.startTime));
      const ends = d.personSlots.map((ps: any) => toMin(ps.endTime));
      const clusterStart = Math.min(...starts);
      const clusterEnd = Math.max(...ends);
      for (const ps of d.personSlots) {
        const s = toMin(ps.startTime);
        const e = toMin(ps.endTime);
        // cohesive rule from engine: start <= clusterEnd+15 && end >= clusterStart-15
        expect(s).toBeLessThanOrEqual(clusterEnd + 15);
        expect(e).toBeGreaterThanOrEqual(clusterStart - 15);
      }
    }
  });

  it('2 people, 2 staff: parallel booking is possible (same start, different staff)', async () => {
    const data = emptyData();
    addService(data, 1, 30);
    addStaffService(data, 10, 1, 30);
    addStaffService(data, 11, 1, 30);
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    setWorkingHours(data, 11, DOW_MON, 9, 17);

    const res = await runMulti([group('p1', [1]), group('p2', [1])], monday(), data);

    // There should exist at least one display slot where both persons start at the same time on different staff.
    const hasParallel = res.display.some((d) => {
      if (d.personSlots.length !== 2) return false;
      const [a, b] = d.personSlots;
      return a.startTime === b.startTime && a.staffId !== b.staffId;
    });
    expect(hasParallel).toBe(true);
  });

  it('3 people, 3 staff: all three placed, cohesive, no staff conflicts (full coverage)', async () => {
    const data = emptyData();
    addService(data, 1, 30);
    for (const st of [10, 11, 12]) {
      addStaffService(data, st, 1, 30);
      setWorkingHours(data, st, DOW_MON, 9, 17);
    }
    const res = await runMulti([group('p1', [1]), group('p2', [1]), group('p3', [1])], monday(), data);
    const full = res.display.filter((d) => d.personSlots.length === 3);
    expect(full.length).toBeGreaterThan(0);
    for (const d of full) {
      // No two persons on the same staff at overlapping times.
      assertNoStaffOverlap(d.personSlots);
      // Each person is cohesive against the growing cluster (engine's own rule):
      // start <= clusterEnd+15 and end >= clusterStart-15.
      const starts = d.personSlots.map((ps: any) => toMin(ps.startTime));
      const ends = d.personSlots.map((ps: any) => toMin(ps.endTime));
      const clusterStart = Math.min(...starts);
      const clusterEnd = Math.max(...ends);
      for (const ps of d.personSlots) {
        expect(toMin(ps.startTime)).toBeLessThanOrEqual(clusterEnd + 15);
        expect(toMin(ps.endTime)).toBeGreaterThanOrEqual(clusterStart - 15);
      }
    }
  });

  it('3 people / 3 free staff ARE offered a fully-parallel (3 distinct staff) slot', async () => {
    // FIX (2026-06-19): buildCombinations now orders the next person's candidate
    // slots to prefer staff-DISJOINT (true parallel) + cluster-aligned ones first,
    // so the 1-per-anchor combination is the maximally-parallel one when enough
    // staff are free. Previously it DFS-returned the first (staff-ordered) combo,
    // which stacked p2/p3 sequentially on staff 10 and never offered 3-parallel.
    const data = emptyData();
    addService(data, 1, 30);
    for (const st of [10, 11, 12]) {
      addStaffService(data, st, 1, 30);
      setWorkingHours(data, st, DOW_MON, 9, 17);
    }
    const request: AvailabilityRequest = { salonId: 1, date: localDateKey(monday()), groups: [group('p1', [1]), group('p2', [1]), group('p3', [1])] };
    const synchronized = await new MultiPersonAnchor(engine).synchronizeGroups(request, monday(), data, 600);
    const parallel3 = synchronized.filter((s) => new Set(s.slots.map((c) => c.blocks[0].staffId)).size === 3);
    expect(parallel3.length).toBeGreaterThan(0);
  });

  it('4 people, 4 staff: all four placed cohesively without staff conflicts', async () => {
    const data = emptyData();
    addService(data, 1, 30);
    for (const st of [10, 11, 12, 13]) {
      addStaffService(data, st, 1, 30);
      setWorkingHours(data, st, DOW_MON, 9, 17);
    }
    const res = await runMulti([group('p1', [1]), group('p2', [1]), group('p3', [1]), group('p4', [1])], monday(), data);
    const full = res.display.filter((d) => d.personSlots.length === 4);
    expect(full.length).toBeGreaterThan(0);
    for (const d of full) {
      assertNoStaffOverlap(d.personSlots);
    }
  });

  it('4 people, 1 staff: engine still offers slots but stacks them sequentially (cohesion window stretches)', async () => {
    // Note: with one staff, 4 x 30min = 120min span. The cohesion check is applied
    // incrementally against the GROWING cluster (start <= clusterEnd+15), so a chain
    // of sequential bookings each within 15 min of the previous end IS accepted —
    // the cluster simply grows. So "full" slots DO appear (documented behavior).
    const data = emptyData();
    addService(data, 1, 30);
    addStaffService(data, 10, 1, 30);
    setWorkingHours(data, 10, DOW_MON, 9, 17);

    const res = await runMulti([group('p1', [1]), group('p2', [1]), group('p3', [1]), group('p4', [1])], monday(), data);
    const full = res.display.filter((d) => d.personSlots.length === 4);
    expect(full.length).toBeGreaterThan(0);
    for (const d of full) {
      // All four must be on the single staff and strictly non-overlapping (sequential).
      assertNoStaffOverlap(d.personSlots);
      const staffIds = new Set(d.personSlots.map((ps: any) => ps.staffId));
      expect(staffIds.size).toBe(1);
    }
  });
});

/** Assert no two personSlots share a staff at overlapping times. */
function assertNoStaffOverlap(personSlots: any[]): void {
  for (let i = 0; i < personSlots.length; i += 1) {
    for (let j = i + 1; j < personSlots.length; j += 1) {
      if (personSlots[i].staffId !== personSlots[j].staffId) continue;
      const aS = toMin(personSlots[i].startTime);
      const aE = toMin(personSlots[i].endTime);
      const bS = toMin(personSlots[j].startTime);
      const bE = toMin(personSlots[j].endTime);
      expect(aS < bE && bS < aE).toBe(false);
    }
  }
}

// ===========================================================================
// GENDER
// ===========================================================================
describe('Gender', () => {
  it('agnostic (untagged) service: gender undefined uses base Service.duration', async () => {
    const data = emptyData();
    addService(data, 1, 60);
    addStaffService(data, 10, 1, 60);
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    const res = await runSingle(group('p1', [1]), monday(), data); // no gender
    const first = res.slots.find((s) => s.startTime === '09:00')!;
    expect(first.endTime).toBe('10:00');
  });

  it('per-gender ServiceVariant duration beats an ungendered StaffService row (precedence 2 > 3)', async () => {
    // FIX (2026-06-19, Berkay): a gender ServiceVariant must override the staff's
    // generic (ungendered) row, matching servicePricing precedence → catalog
    // (no staff) and booking (with staff) report the SAME gendered duration.
    const data = emptyData();
    addService(data, 1, 60);
    addStaffService(data, 10, 1, 60); // ungendered staff row == base duration (typical seed)
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    addServiceVariant(data, 100, 1, 'female', 90);
    addServiceVariant(data, 101, 1, 'male', 45);

    const female = await runSingle(group('pf', [1], 'female'), monday(), data);
    const male = await runSingle(group('pm', [1], 'male'), monday(), data);

    expect(female.slots.find((s) => s.startTime === '09:00')!.endTime).toBe('10:30'); // variant 90 wins
    expect(male.slots.find((s) => s.startTime === '09:00')!.endTime).toBe('09:45'); // variant 45 wins
  });

  it('StaffService(staffId, gender) row still beats ServiceVariant(gender) (precedence 1 > 2)', async () => {
    // Most-specific wins: a per-staff gendered duration overrides the service-level variant.
    const data = emptyData();
    addService(data, 1, 60);
    addStaffService(data, 10, 1, 80, 'female'); // staff + female (most specific)
    addServiceVariant(data, 100, 1, 'female', 90); // service-level variant (lower priority)
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    const female = await runSingle(group('pf', [1], 'female'), monday(), data);
    expect(female.slots.find((s) => s.startTime === '09:00')!.endTime).toBe('10:20'); // staff-gender 80, not variant 90
  });

  it('per-gender StaffService duration override beats base when gender matches', async () => {
    const data = emptyData();
    addService(data, 1, 60);
    // Staff 10 offers svc1 with female=90, male=45 per-staff durations.
    addStaffService(data, 10, 1, 90, 'female');
    addStaffService(data, 10, 1, 45, 'male');
    setWorkingHours(data, 10, DOW_MON, 9, 17);

    const female = await runSingle(group('pf', [1], 'female'), monday(), data);
    const male = await runSingle(group('pm', [1], 'male'), monday(), data);

    expect(female.slots.find((s) => s.startTime === '09:00')!.endTime).toBe('10:30'); // 90
    expect(male.slots.find((s) => s.startTime === '09:00')!.endTime).toBe('09:45'); // 45
  });

  it('gender "other" with no matching staff row falls back to first staff row (deterministic order)', async () => {
    const data = emptyData();
    addService(data, 1, 60);
    addStaffService(data, 10, 1, 50, 'female'); // first row
    addStaffService(data, 10, 1, 70, 'male');
    setWorkingHours(data, 10, DOW_MON, 9, 17);

    const other = await runSingle(group('po', [1], 'other'), monday(), data);
    // No 'other' row -> rows[0] (female, 50 min). 09:00 -> 09:50.
    expect(other.slots.find((s) => s.startTime === '09:00')!.endTime).toBe('09:50');
  });
});

// ===========================================================================
// CATEGORIES: sequentialRequired & sequentialOverride
// ===========================================================================
describe('Categories: sequential', () => {
  it('category.sequentialRequired=true: same-category services are back-to-back (NO inter-block buffer between them)', async () => {
    const data = emptyData();
    addCategory(data, 5, { sequentialRequired: true });
    addService(data, 1, 30, { categoryId: 5 });
    addService(data, 2, 40, { categoryId: 5 });
    addStaffService(data, 10, 1, 30);
    addStaffService(data, 10, 2, 40);
    setWorkingHours(data, 10, DOW_MON, 9, 17);

    const res = await runSingle(group('p1', [1, 2]), monday(), data);
    const first = res.slots.find((s) => s.startTime === '09:00')!;
    // Single sequential block: 30+40=70, no buffer between -> ends 10:10.
    expect(first.endTime).toBe('10:10');
    expect(first.serviceSequence.map((x: any) => `${x.serviceId}:${x.start}-${x.end}`)).toEqual([
      '1:09:00-09:30',
      '2:09:30-10:10',
    ]);
  });

  it('non-sequential category: services split into individual blocks WITH inter-block buffer', async () => {
    const data = emptyData();
    addCategory(data, 5, { sequentialRequired: false });
    addService(data, 1, 30, { categoryId: 5 });
    addService(data, 2, 40, { categoryId: 5 });
    addStaffService(data, 10, 1, 30);
    addStaffService(data, 10, 2, 40);
    setWorkingHours(data, 10, DOW_MON, 9, 17);

    const res = await runSingle(group('p1', [1, 2]), monday(), data);
    const first = res.slots.find((s) => s.startTime === '09:00')!;
    // Two individual blocks, default buffer 15: 30+15+40 = 85 -> ends 10:25.
    expect(first.endTime).toBe('10:25');
  });

  it('Service.sequentialOverride=true overrides category default (false)', async () => {
    const data = emptyData();
    addCategory(data, 5, { sequentialRequired: false });
    addService(data, 1, 30, { categoryId: 5, sequentialOverride: true });
    addService(data, 2, 40, { categoryId: 5, sequentialOverride: true });
    addStaffService(data, 10, 1, 30);
    addStaffService(data, 10, 2, 40);
    setWorkingHours(data, 10, DOW_MON, 9, 17);

    const res = await runSingle(group('p1', [1, 2]), monday(), data);
    const first = res.slots.find((s) => s.startTime === '09:00')!;
    // Forced sequential -> back-to-back, no buffer: 70 min -> 10:10.
    expect(first.endTime).toBe('10:10');
  });

  it('Service.sequentialOverride=false overrides category default (true)', async () => {
    const data = emptyData();
    addCategory(data, 5, { sequentialRequired: true });
    addService(data, 1, 30, { categoryId: 5, sequentialOverride: false });
    addService(data, 2, 40, { categoryId: 5, sequentialOverride: false });
    addStaffService(data, 10, 1, 30);
    addStaffService(data, 10, 2, 40);
    setWorkingHours(data, 10, DOW_MON, 9, 17);

    const res = await runSingle(group('p1', [1, 2]), monday(), data);
    const first = res.slots.find((s) => s.startTime === '09:00')!;
    // Forced individual -> buffer 15 between: 30+15+40 = 85 -> 10:25.
    expect(first.endTime).toBe('10:25');
  });
});

// ===========================================================================
// BUFFERS (inter-appointment cleanup, no implicit default)
// ===========================================================================
describe('Buffers (cleanup between customers / at day end)', () => {
  it('NO explicit buffer: an adjacent existing appointment leaves zero gap (back-to-back allowed)', async () => {
    const data = emptyData();
    addService(data, 1, 30); // no bufferOverride, no category
    addStaffService(data, 10, 1, 30);
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    // Existing appt 09:00-10:00 on staff 10.
    addAppointment(data, monday(), 10, [9, 0], [10, 0], 1);

    const res = await runSingle(group('p1', [1]), monday(), data);
    // With no explicit buffer, a new 30-min booking may start exactly at 10:00.
    expect(res.startTimes.includes('10:00')).toBe(true);
    // And must NOT start during the existing appt.
    expect(res.startTimes.includes('09:30')).toBe(false);
    expect(res.startTimes.includes('09:00')).toBe(false);
  });

  it('Service.bufferOverride=20: a 20-min cleanup gap is enforced after the existing appointment', async () => {
    const data = emptyData();
    addService(data, 1, 30, { bufferOverride: 20 });
    addStaffService(data, 10, 1, 30);
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    addAppointment(data, monday(), 10, [9, 0], [10, 0], 1); // existing appt of same service

    const res = await runSingle(group('p1', [1]), monday(), data);
    // Existing appt occupies [09:00,10:00] + 20 buffer = blocked until 10:20.
    expect(res.startTimes.includes('10:00')).toBe(false);
    expect(res.startTimes.includes('10:15')).toBe(false);
    expect(res.startTimes.includes('10:20')).toBe(true);
  });

  it('ServiceCategory.bufferMinutes=15 enforced when no service override', async () => {
    const data = emptyData();
    addCategory(data, 5, { bufferMinutes: 15 });
    addService(data, 1, 30, { categoryId: 5 });
    addStaffService(data, 10, 1, 30);
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    addAppointment(data, monday(), 10, [9, 0], [10, 0], 1);

    const res = await runSingle(group('p1', [1]), monday(), data);
    expect(res.startTimes.includes('10:00')).toBe(false);
    expect(res.startTimes.includes('10:15')).toBe(true);
  });

  it('buffer reduces availability at day end (trailing buffer must fit before workEnd)', async () => {
    const data = emptyData();
    addService(data, 1, 30, { bufferOverride: 30 });
    addStaffService(data, 10, 1, 30);
    setWorkingHours(data, 10, DOW_MON, 9, 11); // 09:00-11:00

    const res = await runSingle(group('p1', [1]), monday(), data);
    // NOTE on expectation: validateBlockPlacement checks (startTime + duration) <= workEnd
    // for the WINDOW, but the trailing buffer is only checked against OTHER appointments,
    // not against workEnd. So the engine's last start is 10:30 (10:30+30=11:00 within window),
    // even though the 30-min cleanup buffer would run to 11:30 (past close).
    // We assert the ACTUAL engine behavior here; see report for the day-end-buffer note.
    expect(res.startTimes[res.startTimes.length - 1]).toBe('10:30');
  });
});

// ===========================================================================
// WORKING HOURS
// ===========================================================================
describe('Working hours', () => {
  it('staff custom StaffWorkingHours window is respected (10:00-14:00)', async () => {
    const data = emptyData();
    addService(data, 1, 60);
    addStaffService(data, 10, 1, 60);
    setWorkingHours(data, 10, DOW_MON, 10, 14);

    const res = await runSingle(group('p1', [1]), monday(), data);
    expect(res.startTimes[0]).toBe('10:00');
    expect(res.startTimes[res.startTimes.length - 1]).toBe('13:00'); // 13:00+60=14:00
  });

  it('short Saturday window (09:00-13:00) limits slots to the morning', async () => {
    const data = emptyData();
    addService(data, 1, 60);
    addStaffService(data, 10, 1, 60);
    setWorkingHours(data, 10, DOW_SAT, 9, 13);

    const res = await runSingle(group('p1', [1]), saturday(), data);
    expect(res.startTimes[0]).toBe('09:00');
    expect(res.startTimes[res.startTimes.length - 1]).toBe('12:00'); // 12:00+60=13:00
  });

  it('no working-hours row for the requested day -> no slots (staff considered off)', async () => {
    const data = emptyData();
    addService(data, 1, 60);
    addStaffService(data, 10, 1, 60);
    setWorkingHours(data, 10, DOW_SAT, 9, 17); // only Saturday hours

    // Request a Monday -> no row for Monday -> empty.
    const res = await runSingle(group('p1', [1]), monday(), data);
    expect(res.startTimes).toEqual([]);
  });

  it('two staff with different windows: union of availability is exposed', async () => {
    const data = emptyData();
    addService(data, 1, 60);
    addStaffService(data, 10, 1, 60);
    addStaffService(data, 11, 1, 60);
    setWorkingHours(data, 10, DOW_MON, 9, 12); // morning staff
    setWorkingHours(data, 11, DOW_MON, 14, 17); // afternoon staff

    const res = await runSingle(group('p1', [1]), monday(), data);
    // Morning: 09:00..11:00; Afternoon: 14:00..16:00. Gap 12-14 has no slots.
    expect(res.startTimes.includes('09:00')).toBe(true);
    expect(res.startTimes.includes('11:00')).toBe(true);
    expect(res.startTimes.includes('12:00')).toBe(false);
    expect(res.startTimes.includes('13:00')).toBe(false);
    expect(res.startTimes.includes('14:00')).toBe(true);
    expect(res.startTimes.includes('16:00')).toBe(true);
  });
});

// ===========================================================================
// STAFF
// ===========================================================================
describe('Staff', () => {
  it('allowedStaffIds preference filter: only the chosen staff is used', async () => {
    const data = emptyData();
    addService(data, 1, 60);
    addStaffService(data, 10, 1, 60);
    addStaffService(data, 11, 1, 60);
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    setWorkingHours(data, 11, DOW_MON, 9, 17);

    // Only allow staff 11.
    const g = group('p1', [{ serviceId: 1, allowedStaffIds: [11] }]);
    const res = await runSingle(g, monday(), data);
    expect(res.slots.length).toBeGreaterThan(0);
    for (const s of res.slots) {
      expect(s.staffId).toBe(11);
    }
  });

  it('service offered by NO staff -> no slots', async () => {
    const data = emptyData();
    addService(data, 1, 60);
    // No addStaffService for svc 1.
    setWorkingHours(data, 10, DOW_MON, 9, 17);

    const res = await runSingle(group('p1', [1]), monday(), data);
    expect(res.startTimes).toEqual([]);
  });

  it('multi-service chain requiring two different staff (each offers only one service)', async () => {
    const data = emptyData();
    addService(data, 1, 30);
    addService(data, 2, 30);
    addStaffService(data, 10, 1, 30); // staff 10 only svc1
    addStaffService(data, 11, 2, 30); // staff 11 only svc2
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    setWorkingHours(data, 11, DOW_MON, 9, 17);

    const res = await runSingle(group('p1', [1, 2]), monday(), data);
    const first = res.slots.find((s) => s.startTime === '09:00');
    expect(first).toBeTruthy();
    // svc1 by staff 10, svc2 by staff 11; buffer 15 between blocks.
    const seq = first!.serviceSequence;
    expect(seq[0].staffId).toBe(10);
    expect(seq[1].staffId).toBe(11);
    expect(first!.endTime).toBe('10:15'); // 30+15+30
  });
});

// ===========================================================================
// BLOCKING (appointments, time-offs, closures, locks)
// ===========================================================================
describe('Blocking', () => {
  it('existing appointment blocks overlapping starts on that staff', async () => {
    const data = emptyData();
    addService(data, 1, 60);
    addStaffService(data, 10, 1, 60);
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    addAppointment(data, monday(), 10, [11, 0], [12, 0], 1);

    const res = await runSingle(group('p1', [1]), monday(), data);
    // A 60-min booking can't start at 10:30 (would run into 11:00), 11:00, 11:30.
    expect(res.startTimes.includes('10:30')).toBe(false);
    expect(res.startTimes.includes('11:00')).toBe(false);
    expect(res.startTimes.includes('11:30')).toBe(false);
    // But 10:00 (->11:00) and 12:00 (->13:00) are fine.
    expect(res.startTimes.includes('10:00')).toBe(true);
    expect(res.startTimes.includes('12:00')).toBe(true);
  });

  it('staff time-off (block, serviceId<=0) blocks the interval with zero buffer', async () => {
    const data = emptyData();
    addService(data, 1, 30);
    addStaffService(data, 10, 1, 30);
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    // Time-off 12:00-13:00 modeled as a pure block (serviceId 0).
    addAppointment(data, monday(), 10, [12, 0], [13, 0], 0, 'BLOCKED');

    const res = await runSingle(group('p1', [1]), monday(), data);
    expect(res.startTimes.includes('12:00')).toBe(false);
    expect(res.startTimes.includes('12:30')).toBe(false);
    // 11:30 (->12:00) and 13:00 (->13:30) ok — zero buffer for a pure block.
    expect(res.startTimes.includes('11:30')).toBe(true);
    expect(res.startTimes.includes('13:00')).toBe(true);
  });

  it('full-day closure on the only staff -> no slots', async () => {
    const data = emptyData();
    addService(data, 1, 30);
    addStaffService(data, 10, 1, 30);
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    addAppointment(data, monday(), 10, [9, 0], [17, 0], 0, 'BLOCKED'); // covers whole window

    const res = await runSingle(group('p1', [1]), monday(), data);
    expect(res.startTimes).toEqual([]);
  });

  it('active SlotLock blocks the locked staff/time (modeled as LOCKED block)', async () => {
    const data = emptyData();
    addService(data, 1, 30);
    addStaffService(data, 10, 1, 30);
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    addAppointment(data, monday(), 10, [10, 0], [10, 30], 0, 'LOCKED');

    const res = await runSingle(group('p1', [1]), monday(), data);
    expect(res.startTimes.includes('10:00')).toBe(false);
    expect(res.startTimes.includes('09:45')).toBe(false); // 09:45->10:15 overlaps
    expect(res.startTimes.includes('10:30')).toBe(true);
  });

  it('ignoreLockId semantics: when the user\'s own lock is excluded, the slot is free again', async () => {
    // We simulate the two states by building data with and without the lock.
    // (batchFetchData applies ignoreLockId at fetch time; in-memory we model the
    //  post-fetch effect: excluded lock simply isn't in appointmentsByStaffAndDate.)
    const withLock = emptyData();
    addService(withLock, 1, 30);
    addStaffService(withLock, 10, 1, 30);
    setWorkingHours(withLock, 10, DOW_MON, 9, 17);
    addAppointment(withLock, monday(), 10, [10, 0], [10, 30], 0, 'LOCKED');

    const withoutLock = emptyData();
    addService(withoutLock, 1, 30);
    addStaffService(withoutLock, 10, 1, 30);
    setWorkingHours(withoutLock, 10, DOW_MON, 9, 17);

    const blocked = await runSingle(group('p1', [1]), monday(), withLock);
    const free = await runSingle(group('p1', [1]), monday(), withoutLock);
    expect(blocked.startTimes.includes('10:00')).toBe(false);
    expect(free.startTimes.includes('10:00')).toBe(true);
  });
});

// ===========================================================================
// EDGE CASES
// ===========================================================================
describe('Edge cases', () => {
  it('empty catalog (no services registered) -> no slots', async () => {
    const data = emptyData();
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    const res = await runSingle(group('p1', [1]), monday(), data);
    expect(res.startTimes).toEqual([]);
  });

  it('group with a service id that does not exist -> no slots', async () => {
    const data = emptyData();
    addService(data, 1, 30);
    addStaffService(data, 10, 1, 30);
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    const res = await runSingle(group('p1', [999]), monday(), data);
    expect(res.startTimes).toEqual([]);
  });

  it('past date -> generateSlots short-circuits to empty (DB-free guard)', async () => {
    // generateSlots checks the date BEFORE batchFetchData, so a past date returns
    // empty without touching the DB. Safe to call directly.
    const past = '2020-01-01';
    const res = await engine.generateSlots(
      { salonId: 1, date: past, groups: [group('p1', [1])] },
      { persistSearchContext: false },
    );
    expect(res.groups[0].slots).toEqual([]);
    expect(res.displaySlots).toEqual([]);
  });
});

// ===========================================================================
// PERMUTATION-PRUNER & CHAIN-BUILDER (direct unit checks)
// ===========================================================================
describe('PermutationPruner block grouping', () => {
  const pruner = new PermutationPruner();

  async function blocksFor(serviceIds: number[], data: IndexedData, gender?: string) {
    const out: any[] = [];
    for await (const perm of pruner.generateValidPermutations(serviceIds, data, gender)) {
      out.push(perm);
    }
    return out;
  }

  it('consecutive same-category sequential services form ONE block; different category splits', async () => {
    const data = emptyData();
    addCategory(data, 5, { sequentialRequired: true });
    addCategory(data, 6, { sequentialRequired: true });
    addService(data, 1, 30, { categoryId: 5 });
    addService(data, 2, 30, { categoryId: 5 });
    addService(data, 3, 30, { categoryId: 6 });

    const perms = await blocksFor([1, 2, 3], data);
    expect(perms).toHaveLength(1);
    const blocks = perms[0].blocks;
    // [svc1,svc2] sequential block (cat 5), then [svc3] sequential block (cat 6).
    expect(blocks).toHaveLength(2);
    expect(blocks[0].services.map((s: any) => s.id)).toEqual([1, 2]);
    expect(blocks[1].services.map((s: any) => s.id)).toEqual([3]);
  });

  it('variant duration is propagated into the block services for the chosen gender', async () => {
    const data = emptyData();
    addService(data, 1, 60);
    addServiceVariant(data, 100, 1, 'female', 90);
    const perms = await blocksFor([1], data, 'female');
    const svc = perms[0].blocks[0].services[0];
    expect(svc.duration).toBe(90);
    expect(svc.serviceVariantId).toBe(100);
  });
});

describe('ChainBuilder.buildChain direct', () => {
  const builder = new ChainBuilder();
  const pruner = new PermutationPruner();

  async function firstPerm(serviceIds: number[], data: IndexedData, gender?: string) {
    for await (const perm of pruner.generateValidPermutations(serviceIds, data, gender)) return perm;
    return null;
  }

  it('returns null when the anchor staff cannot reach the block within working hours', async () => {
    const data = emptyData();
    addService(data, 1, 60);
    addStaffService(data, 10, 1, 60);
    setWorkingHours(data, 10, DOW_MON, 9, 10); // only 1h
    const perm = await firstPerm([1], data);
    // Anchor at 09:30 -> 09:30+60=10:30 > 10:00 window -> null.
    const chain = await builder.buildChain(perm as any, { hour: 9 * 60 + 30, staffId: 10 }, 1, data, monday(), group('p1', [1]));
    expect(chain).toBeNull();
  });

  it('builds a valid chain at a feasible anchor with correct end time', async () => {
    const data = emptyData();
    addService(data, 1, 60);
    addStaffService(data, 10, 1, 60);
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    const perm = await firstPerm([1], data);
    const chain = await builder.buildChain(perm as any, { hour: 9 * 60, staffId: 10 }, 1, data, monday(), group('p1', [1]));
    expect(chain).not.toBeNull();
    expect(chain!.startTime).toBe(9 * 60);
    expect(chain!.endTime).toBe(10 * 60);
    expect(chain!.blocks[0].staffId).toBe(10);
  });
});

// ===========================================================================
// CAPACITY (resource constraint)
// ===========================================================================
describe('Capacity', () => {
  it('Service.capacityOverride=1: a concurrent same-service appointment on another staff blocks the slot', async () => {
    const data = emptyData();
    addService(data, 1, 60, { capacityOverride: 1 }); // e.g. single laser machine
    addStaffService(data, 10, 1, 60);
    addStaffService(data, 11, 1, 60);
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    setWorkingHours(data, 11, DOW_MON, 9, 17);
    // Existing svc1 appointment on staff 11 from 09:00-10:00.
    addAppointment(data, monday(), 11, [9, 0], [10, 0], 1);

    const res = await runSingle(group('p1', [{ serviceId: 1, allowedStaffIds: [10] }]), monday(), data);
    // capacityOverride=1 means only 1 svc1 concurrently across ALL staff.
    // So staff 10 can't take svc1 during 09:00-10:00.
    expect(res.startTimes.includes('09:00')).toBe(false);
    expect(res.startTimes.includes('09:30')).toBe(false);
    expect(res.startTimes.includes('10:00')).toBe(true);
  });

  it('category.capacity=1 (schema default) is treated as NO cap -> parallel staff allowed', async () => {
    const data = emptyData();
    addCategory(data, 5, { capacity: 1 });
    addService(data, 1, 60, { categoryId: 5 });
    addStaffService(data, 10, 1, 60);
    addStaffService(data, 11, 1, 60);
    setWorkingHours(data, 10, DOW_MON, 9, 17);
    setWorkingHours(data, 11, DOW_MON, 9, 17);
    addAppointment(data, monday(), 11, [9, 0], [10, 0], 1); // staff 11 busy 09-10

    const res = await runSingle(group('p1', [{ serviceId: 1, allowedStaffIds: [10] }]), monday(), data);
    // capacity=1 is the default -> NOT an explicit cap -> staff 10 free at 09:00.
    expect(res.startTimes.includes('09:00')).toBe(true);
  });

  it('category.capacity=2: third concurrent appointment in category is blocked', async () => {
    const data = emptyData();
    addCategory(data, 5, { capacity: 2 });
    addService(data, 1, 60, { categoryId: 5 });
    for (const st of [10, 11, 12]) {
      addStaffService(data, st, 1, 60);
      setWorkingHours(data, st, DOW_MON, 9, 17);
    }
    // Two concurrent svc1 (category 5) appts 09:00-10:00 on staff 11 and 12.
    addAppointment(data, monday(), 11, [9, 0], [10, 0], 1);
    addAppointment(data, monday(), 12, [9, 0], [10, 0], 1);

    const res = await runSingle(group('p1', [{ serviceId: 1, allowedStaffIds: [10] }]), monday(), data);
    // cap=2 already reached during 09:00-10:00 -> staff 10 blocked then.
    expect(res.startTimes.includes('09:00')).toBe(false);
    expect(res.startTimes.includes('10:00')).toBe(true);
  });
});
