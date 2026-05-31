import { describe, it, expect } from 'vitest';
import { UpdateAppointmentServicesInputSchema } from '../src/schemas/appointment-input.js';

describe('UpdateAppointmentServicesInputSchema', () => {
  it('boş add + boş remove reddedilir', () => {
    const result = UpdateAppointmentServicesInputSchema.safeParse({ add: [], remove: [] });
    expect(result.success).toBe(false);
  });

  it('hiçbir alan yokken reddedilir (default ile bile boş)', () => {
    const result = UpdateAppointmentServicesInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('sadece add ile kabul edilir', () => {
    const result = UpdateAppointmentServicesInputSchema.safeParse({
      add: [{ serviceId: 5 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.add).toHaveLength(1);
      expect(result.data.remove).toEqual([]);
    }
  });

  it('sadece remove ile kabul edilir', () => {
    const result = UpdateAppointmentServicesInputSchema.safeParse({
      remove: [{ appointmentLineId: 42 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.remove).toHaveLength(1);
      expect(result.data.add).toEqual([]);
    }
  });

  it('add + remove birlikte kabul edilir', () => {
    const result = UpdateAppointmentServicesInputSchema.safeParse({
      add: [{ serviceId: 5, staffId: 12 }],
      remove: [{ appointmentLineId: 42 }],
      expectedUpdatedAt: '2026-05-31T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('staffId null olabilir (uzman fark etmez)', () => {
    const result = UpdateAppointmentServicesInputSchema.safeParse({
      add: [{ serviceId: 5, staffId: null }],
    });
    expect(result.success).toBe(true);
  });

  it('negatif serviceId reddedilir', () => {
    const result = UpdateAppointmentServicesInputSchema.safeParse({
      add: [{ serviceId: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it('sıfır serviceId reddedilir', () => {
    const result = UpdateAppointmentServicesInputSchema.safeParse({
      add: [{ serviceId: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it('durationMinutes negatif olamaz', () => {
    const result = UpdateAppointmentServicesInputSchema.safeParse({
      add: [{ serviceId: 5, durationMinutes: -10 }],
    });
    expect(result.success).toBe(false);
  });

  it('opsiyonel alanlar gönderilmezse defaultlar kullanılır', () => {
    const result = UpdateAppointmentServicesInputSchema.safeParse({
      add: [{ serviceId: 5 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.add[0].staffId).toBeUndefined();
      expect(result.data.add[0].durationMinutes).toBeUndefined();
      expect(result.data.add[0].startTime).toBeUndefined();
    }
  });

  it('startTime string olarak alınır', () => {
    const result = UpdateAppointmentServicesInputSchema.safeParse({
      add: [{ serviceId: 5, startTime: '2026-06-01T14:30:00.000Z' }],
    });
    expect(result.success).toBe(true);
  });

  it('appointmentLineId pozitif int olmalı', () => {
    const r1 = UpdateAppointmentServicesInputSchema.safeParse({ remove: [{ appointmentLineId: 0 }] });
    const r2 = UpdateAppointmentServicesInputSchema.safeParse({ remove: [{ appointmentLineId: 1.5 }] });
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
  });

  it('birden fazla add + remove birlikte', () => {
    const result = UpdateAppointmentServicesInputSchema.safeParse({
      add: [
        { serviceId: 5, staffId: 12 },
        { serviceId: 7, staffId: null, durationMinutes: 45 },
      ],
      remove: [{ appointmentLineId: 100 }, { appointmentLineId: 101 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.add).toHaveLength(2);
      expect(result.data.remove).toHaveLength(2);
    }
  });
});
