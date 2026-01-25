import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AvailabilityEngine } from './engine';
import { DateNormalizer } from './normalizer';

describe('AvailabilityEngine', () => {
  let engine: AvailabilityEngine;

  beforeEach(() => {
    engine = new AvailabilityEngine();
  });

  describe('DateNormalizer', () => {
    it('should parse date string correctly', () => {
      const result = DateNormalizer.parseDate('2024-01-15');
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0); // January is 0
      expect(result.getDate()).toBe(15);
    });

    it('should throw on invalid date', () => {
      expect(() => DateNormalizer.parseDate('invalid')).toThrow();
    });

    it('should parse time to minutes correctly', () => {
      expect(DateNormalizer.parseTimeToMinutes('09:00')).toBe(540);
      expect(DateNormalizer.parseTimeToMinutes('18:30')).toBe(1110);
    });

    it('should throw on invalid time', () => {
      expect(() => DateNormalizer.parseTimeToMinutes('25:00')).toThrow();
      expect(() => DateNormalizer.parseTimeToMinutes('10:60')).toThrow();
    });

    it('should create DateTime from date and minutes', () => {
      const result = DateNormalizer.createDateTime('2024-01-15', 540); // 9:00
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0);
      expect(result.getDate()).toBe(15);
      expect(result.getHours()).toBe(9);
      expect(result.getMinutes()).toBe(0);
    });

    it('should parse duration correctly', () => {
      expect(DateNormalizer.parseDuration('60')).toBe(60);
      expect(DateNormalizer.parseDuration('30')).toBe(30);
    });

    it('should throw on invalid duration', () => {
      expect(() => DateNormalizer.parseDuration('0')).toThrow();
      expect(() => DateNormalizer.parseDuration('abc')).toThrow();
    });
  });

  describe('Slot Generation', () => {
    it('should generate 15-minute slots from 9 AM to 6 PM', () => {
      const date = new Date('2024-01-15');
      const slots = (engine as any).generateTimeSlots(date);

      expect(slots.length).toBe(36); // (18-9) * 4 = 36 slots

      // Check first slot
      expect(slots[0].getHours()).toBe(9);
      expect(slots[0].getMinutes()).toBe(0);

      // Check last slot
      expect(slots[slots.length - 1].getHours()).toBe(17);
      expect(slots[slots.length - 1].getMinutes()).toBe(45);
    });
  });

  describe('Time Overlap Detection', () => {
    it('should detect overlapping time ranges', () => {
      const engineAny = engine as any;

      const slot1Start = new Date('2024-01-15T10:00:00');
      const slot1End = new Date('2024-01-15T11:00:00');

      const slot2Start = new Date('2024-01-15T10:30:00');
      const slot2End = new Date('2024-01-15T11:30:00');

      expect(engineAny.timesOverlap(slot1Start, slot1End, slot2Start, slot2End)).toBe(true);
    });

    it('should not detect non-overlapping ranges', () => {
      const engineAny = engine as any;

      const slot1Start = new Date('2024-01-15T10:00:00');
      const slot1End = new Date('2024-01-15T11:00:00');

      const slot2Start = new Date('2024-01-15T11:00:00');
      const slot2End = new Date('2024-01-15T12:00:00');

      expect(engineAny.timesOverlap(slot1Start, slot1End, slot2Start, slot2End)).toBe(false);
    });
  });

  describe('Date Range Checking', () => {
    it('should detect dates within range', () => {
      const engineAny = engine as any;

      const checkDate = new Date('2024-01-15T10:00:00');
      const rangeStart = new Date('2024-01-14');
      const rangeEnd = new Date('2024-01-16');

      expect(engineAny.dateInRange(checkDate, rangeStart, rangeEnd)).toBe(true);
    });

    it('should not detect dates outside range', () => {
      const engineAny = engine as any;

      const checkDate = new Date('2024-01-17T10:00:00');
      const rangeStart = new Date('2024-01-14');
      const rangeEnd = new Date('2024-01-16');

      expect(engineAny.dateInRange(checkDate, rangeStart, rangeEnd)).toBe(false);
    });
  });

  describe('Staff Availability', () => {
    it('should find available staff excluding those with appointments', () => {
      const engineAny = engine as any;

      const slotStart = new Date('2024-01-15T10:00:00');
      const slotEnd = new Date('2024-01-15T10:15:00');

      const constraints = {
        appointments: [
          {
            staffId: 1,
            startTime: new Date('2024-01-15T10:00:00'),
            endTime: new Date('2024-01-15T11:00:00')
          }
        ],
        leaves: [],
        locks: []
      };

      const availableStaff = engineAny.findAvailableStaff(slotStart, slotEnd, constraints, 1);
      expect(availableStaff).not.toContain(1);
      expect(availableStaff.length).toBeGreaterThan(0);
    });

    it('should exclude staff on leave', () => {
      const engineAny = engine as any;

      const slotStart = new Date('2024-01-15T10:00:00');
      const slotEnd = new Date('2024-01-15T10:15:00');

      const constraints = {
        appointments: [],
        leaves: [
          {
            staffId: 2,
            startDate: new Date('2024-01-15'),
            endDate: new Date('2024-01-15')
          }
        ],
        locks: []
      };

      const availableStaff = engineAny.findAvailableStaff(slotStart, slotEnd, constraints, 1);
      expect(availableStaff).not.toContain(2);
    });
  });

  describe('Slot Ranking', () => {
    it('should rank slots by time then by staff availability', () => {
      const engineAny = engine as any;

      const slots = [
        {
          startTime: new Date('2024-01-15T14:00:00'),
          endTime: new Date('2024-01-15T14:15:00'),
          availableStaff: [1, 2],
          optionId: '1'
        },
        {
          startTime: new Date('2024-01-15T10:00:00'),
          endTime: new Date('2024-01-15T10:15:00'),
          availableStaff: [1],
          optionId: '2'
        },
        {
          startTime: new Date('2024-01-15T10:00:00'),
          endTime: new Date('2024-01-15T10:15:00'),
          availableStaff: [1, 2, 3],
          optionId: '3'
        }
      ];

      const ranked = engineAny.rankSlots(slots);

      // First slot should be the 10 AM slot with most staff (optionId '3')
      expect(ranked[0].optionId).toBe('3');
      // Second should be 10 AM slot with fewer staff (optionId '2')
      expect(ranked[1].optionId).toBe('2');
      // Third should be the 2 PM slot (optionId '1')
      expect(ranked[2].optionId).toBe('1');
    });
  });

  describe('Lock Token Generation', () => {
    it('should generate lock token with 15 minute expiry', () => {
      const engineAny = engine as any;
      const token = engineAny.generateLockToken();

      expect(token.id).toBeDefined();
      expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(token.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000 + 1000); // Allow 1 second tolerance
    });
  });

  describe('Edge Cases', () => {
    it('should handle overlapping appointments correctly', () => {
      const engineAny = engine as any;

      const slotStart = new Date('2024-01-15T10:00:00');
      const slotEnd = new Date('2024-01-15T10:15:00');

      const constraints = {
        appointments: [
          {
            staffId: 1,
            startTime: new Date('2024-01-15T09:45:00'),
            endTime: new Date('2024-01-15T10:15:00')
          }
        ],
        leaves: [],
        locks: []
      };

      const conflicts = engineAny.checkSlotConflicts(slotStart, slotEnd, constraints);
      expect(conflicts.length).toBe(1);
    });

    it('should handle expired locks', () => {
      const engineAny = engine as any;

      const slotStart = new Date('2024-01-15T10:00:00');
      const slotEnd = new Date('2024-01-15T10:15:00');

      const pastExpiry = new Date();
      pastExpiry.setMinutes(pastExpiry.getMinutes() - 10);

      const constraints = {
        appointments: [],
        leaves: [],
        locks: [
          {
            expiresAt: pastExpiry,
            startTime: new Date('2024-01-15T10:00:00'),
            endTime: new Date('2024-01-15T10:15:00')
          }
        ]
      };

      const conflicts = engineAny.checkSlotConflicts(slotStart, slotEnd, constraints);
      expect(conflicts.length).toBe(0); // Expired lock should not conflict
    });

    it('should require minimum staff for multi-person bookings', () => {
      const engineAny = engine as any;

      const slots = [new Date('2024-01-15T10:00:00')];
      const constraints = {
        appointments: [],
        leaves: [],
        locks: []
      };

      // Mock findAvailableStaff to return only 1 staff
      vi.spyOn(engineAny, 'findAvailableStaff').mockReturnValue([1]);

      const availableSlots = engineAny.filterAvailableSlots(slots, constraints, 2);
      expect(availableSlots.length).toBe(0); // Should require 2 staff but only 1 available
    });
  });
});