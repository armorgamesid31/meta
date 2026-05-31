import { z } from 'zod';

export const AppointmentServiceLineInputSchema = z.object({
  serviceId: z.number().int().positive(),
  staffId: z.number().int().positive().nullable(),
});
export type AppointmentServiceLineInput = z.infer<typeof AppointmentServiceLineInputSchema>;

export const CreateAppointmentInputSchema = z.object({
  customerId: z.number().int().positive().nullable().optional(),
  // Composer sends firstName + lastName (and a derived customerName for
  // backwards-compat). For an existing customerId both name fields are
  // ignored, so they're just optional below.
  customerName: z.string().trim().min(1, 'Müşteri adı zorunludur.'),
  firstName: z.string().trim().nullable().optional(),
  lastName: z.string().trim().nullable().optional(),
  customerPhone: z.string().trim().min(4, 'Telefon zorunludur.'),
  startTime: z.string().min(1, 'Başlangıç zamanı zorunludur.'),
  notes: z.string().nullable().optional(),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  // Yeni müşteri kaydı için ek profil alanları — customerId boşsa create
  // anında customer.create data'sına geçirilir; EXISTING müşteride yok sayılır.
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Doğum tarihi YYYY-MM-DD formatında olmalı.').nullable().optional(),
  instagram: z.string().trim().nullable().optional(),
  acceptMarketing: z.boolean().nullable().optional(),
  services: z.array(AppointmentServiceLineInputSchema).min(1, 'En az bir hizmet seçmelisiniz.'),
  // Slot kilidi: admin "yeni randevu" sheet'inde bir slot tıkladığında
  // POST /appointments/lock ile alınan id. Commit anında validate edilip
  // başarılı insert'ten sonra silinir.
  slotLockId: z.string().min(1).nullable().optional(),
  // Çift tıklama / retry koruması.
  idempotencyKey: z.string().min(1).nullable().optional(),
});
export type CreateAppointmentInput = z.infer<typeof CreateAppointmentInputSchema>;

/**
 * Mevcut bir randevuda hizmet ekle/çıkar. Tarih/saat değişimi reschedule
 * endpoint'inde yapılır — burada SADECE line ekleme/silme. Eklenen line'lar
 * randevunun mevcut bitişine sırayla "kuyruğa eklenir"; FE çakışma alırsa
 * (409) alternatif staff/saat seçtirir ve yeni isteği gönderir.
 */
export const UpdateAppointmentServicesInputSchema = z
  .object({
    add: z
      .array(
        z.object({
          serviceId: z.number().int().positive(),
          staffId: z.number().int().positive().nullable().optional(),
          // Manuel duration override (dakika). Verilmezse: variant >
          // staffService > base service.
          durationMinutes: z.number().int().positive().optional(),
          // FE alternatif-modali açıldığında bu hizmet için seçilen
          // başlangıç saati (ISO). Verilmezse mevcut bitişe eklenir.
          startTime: z.string().min(1).optional(),
        }),
      )
      .optional()
      .default([]),
    remove: z
      .array(
        z.object({
          appointmentLineId: z.number().int().positive(),
        }),
      )
      .optional()
      .default([]),
    expectedUpdatedAt: z.string().optional(),
  })
  .refine((data) => (data.add?.length ?? 0) + (data.remove?.length ?? 0) > 0, {
    message: 'En az bir hizmet eklenmeli veya çıkarılmalıdır.',
  });
export type UpdateAppointmentServicesInput = z.infer<typeof UpdateAppointmentServicesInputSchema>;

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
  firstName: z.string().trim().nullable().optional(),
  lastName: z.string().trim().nullable().optional(),
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
