import { describe, it, expect } from 'vitest';
import { RefundAppointmentsInputSchema } from '../src/schemas/appointment-input.js';

describe('RefundAppointmentsInputSchema', () => {
  const minimalValid = {
    appointmentIds: [42],
    refundPayments: [{ method: 'CASH', amount: 500 }],
  };

  it('minimum payload kabul', () => {
    const r = RefundAppointmentsInputSchema.safeParse(minimalValid);
    expect(r.success).toBe(true);
  });

  it('appointmentIds boş reddedilir', () => {
    const r = RefundAppointmentsInputSchema.safeParse({
      ...minimalValid,
      appointmentIds: [],
    });
    expect(r.success).toBe(false);
  });

  it('appointmentIds negatif reddedilir', () => {
    const r = RefundAppointmentsInputSchema.safeParse({
      ...minimalValid,
      appointmentIds: [-1],
    });
    expect(r.success).toBe(false);
  });

  it('refundPayments boş reddedilir', () => {
    const r = RefundAppointmentsInputSchema.safeParse({
      ...minimalValid,
      refundPayments: [],
    });
    expect(r.success).toBe(false);
  });

  it('refundPayments negatif amount reddedilir', () => {
    const r = RefundAppointmentsInputSchema.safeParse({
      ...minimalValid,
      refundPayments: [{ method: 'CASH', amount: -100 }],
    });
    expect(r.success).toBe(false);
  });

  it('refundPayments 0 amount reddedilir', () => {
    const r = RefundAppointmentsInputSchema.safeParse({
      ...minimalValid,
      refundPayments: [{ method: 'CASH', amount: 0 }],
    });
    expect(r.success).toBe(false);
  });

  it('birden fazla appointmentId kabul', () => {
    const r = RefundAppointmentsInputSchema.safeParse({
      ...minimalValid,
      appointmentIds: [42, 43, 44],
    });
    expect(r.success).toBe(true);
  });

  it('split refundPayments kabul', () => {
    const r = RefundAppointmentsInputSchema.safeParse({
      appointmentIds: [42],
      refundPayments: [
        { method: 'CASH', amount: 300 },
        { method: 'CARD', amount: 200 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('parentBatchId opsiyonel', () => {
    const r = RefundAppointmentsInputSchema.safeParse({
      ...minimalValid,
      parentBatchId: 99,
    });
    expect(r.success).toBe(true);
  });

  it('idempotencyKey + notes opsiyonel', () => {
    const r = RefundAppointmentsInputSchema.safeParse({
      ...minimalValid,
      notes: 'müşteri memnun kalmadı',
      idempotencyKey: 'abc-123',
    });
    expect(r.success).toBe(true);
  });
});
