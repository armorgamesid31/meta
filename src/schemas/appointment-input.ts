import { z } from 'zod';

export const AppointmentServiceLineInputSchema = z.object({
  serviceId: z.number().int().positive(),
  staffId: z.number().int().positive().nullable(),
});
export type AppointmentServiceLineInput = z.infer<typeof AppointmentServiceLineInputSchema>;

export const CreateAppointmentInputSchema = z.object({
  customerId: z.number().int().positive().nullable().optional(),
  customerName: z.string().trim().min(1, 'Müşteri adı zorunludur.'),
  customerPhone: z.string().trim().min(4, 'Telefon zorunludur.'),
  startTime: z.string().min(1, 'Başlangıç zamanı zorunludur.'),
  notes: z.string().nullable().optional(),
  services: z.array(AppointmentServiceLineInputSchema).min(1, 'En az bir hizmet seçmelisiniz.'),
});
export type CreateAppointmentInput = z.infer<typeof CreateAppointmentInputSchema>;

export const UpdateAppointmentStatusInputSchema = z.object({
  status: z.enum(['BOOKED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'PENDING']),
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER', 'OTHER']).optional(),
  /**
   * Optimistic concurrency control: client gönderirse, sunucu mevcut
   * appointment.updatedAt değeri ile karşılaştırır; eşleşmezse 409 (STALE_RECORD).
   * Geriye uyumluluk: gönderilmezse kontrol atlanır.
   */
  expectedUpdatedAt: z.string().optional(),
});
export type UpdateAppointmentStatusInput = z.infer<typeof UpdateAppointmentStatusInputSchema>;

export const UpdateCustomerInputSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(4).optional(),
  instagram: z.string().trim().nullable().optional(),
  birthDate: z.string().trim().nullable().optional(),
  acceptMarketing: z.boolean().optional(),
  /**
   * Optimistic concurrency control: client gönderirse, sunucu mevcut
   * customer.updatedAt değeri ile karşılaştırır; eşleşmezse 409 (STALE_RECORD).
   * Geriye uyumluluk: gönderilmezse kontrol atlanır.
   */
  expectedUpdatedAt: z.string().optional(),
});
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerInputSchema>;

export const CreateWaitlistInputSchema = z.object({
  customerId: z.number().int().positive().nullable().optional(),
  customerName: z.string().trim().min(1, 'Müşteri adı zorunludur.'),
  customerPhone: z.string().trim().min(4, 'Telefon zorunludur.'),
  date: z.string().min(1, 'Tarih zorunludur.'),
  timeWindowStart: z.string().min(1),
  timeWindowEnd: z.string().min(1),
  notes: z.string().nullable().optional(),
  allowNearbyMatches: z.boolean().optional(),
  nearbyToleranceMinutes: z.number().int().nonnegative().optional(),
  groups: z.array(z.unknown()).optional(),
});
export type CreateWaitlistInput = z.infer<typeof CreateWaitlistInputSchema>;
