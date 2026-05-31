import { describe, it, expect } from 'vitest';
import { WalkInAppointmentInputSchema } from '../src/schemas/appointment-input.js';

describe('WalkInAppointmentInputSchema', () => {
  const minimalValid = {
    services: [{ serviceId: 5, staffId: null }],
    paymentMethod: 'CASH',
  };

  it('minimum payload kabul edilir (misafir, CASH)', () => {
    const r = WalkInAppointmentInputSchema.safeParse(minimalValid);
    expect(r.success).toBe(true);
  });

  it('services boş olamaz', () => {
    const r = WalkInAppointmentInputSchema.safeParse({
      ...minimalValid,
      services: [],
    });
    expect(r.success).toBe(false);
  });

  it('paymentMethod zorunlu', () => {
    const { paymentMethod, ...rest } = minimalValid;
    const r = WalkInAppointmentInputSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it('paymentMethod enum dışı reddedilir', () => {
    const r = WalkInAppointmentInputSchema.safeParse({
      ...minimalValid,
      paymentMethod: 'BITCOIN',
    });
    expect(r.success).toBe(false);
  });

  it('4 paymentMethod değeri de kabul', () => {
    for (const pm of ['CASH', 'CARD', 'TRANSFER', 'OTHER']) {
      const r = WalkInAppointmentInputSchema.safeParse({
        ...minimalValid,
        paymentMethod: pm,
      });
      expect(r.success).toBe(true);
    }
  });

  it('müşteri bilgisi opsiyonel — hepsi yokken kabul', () => {
    const r = WalkInAppointmentInputSchema.safeParse({
      services: [{ serviceId: 5, staffId: null }],
      paymentMethod: 'CASH',
    });
    expect(r.success).toBe(true);
  });

  it('customerId pozitif int olmalı', () => {
    const r = WalkInAppointmentInputSchema.safeParse({
      ...minimalValid,
      customerId: -1,
    });
    expect(r.success).toBe(false);
  });

  it('birthDate YYYY-MM-DD formatı zorunlu', () => {
    const r = WalkInAppointmentInputSchema.safeParse({
      ...minimalValid,
      birthDate: '15-07-1990',
    });
    expect(r.success).toBe(false);
  });

  it('birthDate doğru formatta kabul', () => {
    const r = WalkInAppointmentInputSchema.safeParse({
      ...minimalValid,
      birthDate: '1990-07-15',
    });
    expect(r.success).toBe(true);
  });

  it('staffId null geçilebilir (uzman fark etmez)', () => {
    const r = WalkInAppointmentInputSchema.safeParse({
      services: [{ serviceId: 5, staffId: null }],
      paymentMethod: 'CASH',
    });
    expect(r.success).toBe(true);
  });

  it('birden fazla hizmet kabul', () => {
    const r = WalkInAppointmentInputSchema.safeParse({
      services: [
        { serviceId: 5, staffId: 12 },
        { serviceId: 7, staffId: null },
      ],
      paymentMethod: 'CARD',
    });
    expect(r.success).toBe(true);
  });

  it('acceptMarketing + gender + notes ek alanlar kabul', () => {
    const r = WalkInAppointmentInputSchema.safeParse({
      ...minimalValid,
      customerName: 'Ayşe Yılmaz',
      customerPhone: '+905551234567',
      gender: 'female',
      instagram: 'ayse_test',
      acceptMarketing: true,
      notes: 'kapıdan geldi',
    });
    expect(r.success).toBe(true);
  });
});
