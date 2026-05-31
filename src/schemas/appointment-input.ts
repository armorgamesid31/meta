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

/**
 * Walk-in (ayak müşterisi) randevu — randevusuz gelen müşteri için anlık,
 * tamamlanmış kayıt. Tarih/saat seçilmez (server = şu an), durum COMPLETED,
 * ödeme yöntemi zorunlu. Müşteri kaydı opsiyonel; ad/telefon yoksa
 * 'Misafir Müşteri' olarak kaydedilir.
 */
export const WalkInAppointmentInputSchema = z.object({
  // Mevcut müşteri seçilmişse id; yoksa null.
  customerId: z.number().int().positive().nullable().optional(),
  // Yeni müşteri için ad/telefon — ikisi de opsiyonel. Telefon varsa
  // backend upsert yapar (aynı numara varsa onu kullanır).
  customerName: z.string().trim().nullable().optional(),
  firstName: z.string().trim().nullable().optional(),
  lastName: z.string().trim().nullable().optional(),
  customerPhone: z.string().trim().nullable().optional(),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  // Ek profil alanları (yeni müşteride doldurulduysa kayda eklenir).
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  instagram: z.string().trim().nullable().optional(),
  acceptMarketing: z.boolean().nullable().optional(),
  // Zorunlu: en az 1 hizmet.
  services: z.array(AppointmentServiceLineInputSchema).min(1, 'En az bir hizmet seçmelisiniz.'),
  // Split ödeme: çoklu yöntem + tutar. Sum = hizmetlerin finalPrice toplamı.
  // payments verilirse paymentMethod yok sayılır. Eski client'lar için
  // paymentMethod tek-değer kabul edilmeye devam eder (geriye uyumluluk:
  // backend tek satırlı batch oluşturur).
  payments: z
    .array(
      z.object({
        method: z.enum(['CASH', 'CARD', 'TRANSFER', 'OTHER']),
        amount: z.number().positive('Tutar 0 üzerinde olmalı.'),
      }),
    )
    .min(1)
    .optional(),
  // Geriye uyum: payments boşsa zorunlu, doluysa görmezden gelinir.
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER', 'OTHER']).optional(),
  notes: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1).nullable().optional(),
}).refine(
  (data) => Boolean(data.payments?.length) || Boolean(data.paymentMethod),
  { message: 'paymentMethod veya payments alanlarından biri zorunlu.', path: ['paymentMethod'] },
);
export type WalkInAppointmentInput = z.infer<typeof WalkInAppointmentInputSchema>;

export const UpdateAppointmentStatusInputSchema = z.object({
  status: z.enum(['BOOKED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'PENDING']),
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER', 'OTHER']).optional(),
  /**
   * Split ödeme: status=COMPLETED + payments dizisi → PaymentBatch oluşur.
   * payments verilirse paymentMethod yok sayılır. Eski client'lar tek-yöntem
   * paymentMethod ile geriye uyumlu çalışmaya devam eder.
   */
  payments: z
    .array(
      z.object({
        method: z.enum(['CASH', 'CARD', 'TRANSFER', 'OTHER']),
        amount: z.number().positive(),
      }),
    )
    .min(1)
    .optional(),
  /**
   * Optimistic concurrency control: client gönderirse, sunucu mevcut
   * appointment.updatedAt değeri ile karşılaştırır; eşleşmezse 409 (STALE_RECORD).
   * Geriye uyumluluk: gönderilmezse kontrol atlanır.
   */
  expectedUpdatedAt: z.string().optional(),
});
export type UpdateAppointmentStatusInput = z.infer<typeof UpdateAppointmentStatusInputSchema>;

/**
 * İade (Refund) endpoint girdisi. Tam veya kısmi iade için kullanılır.
 *
 * - appointmentIds: iade edilecek randevu(lar). Tek bir randevu da olabilir.
 * - refundPayments: hangi yöntemden ne kadar iade edileceği. Toplam, iade
 *   edilen randevuların net ödenmiş tutarından büyük olamaz (kısmi
 *   iadelerde küçük olabilir).
 * - parentBatchId: opsiyonel — hangi pozitif batch'i refund ettiğimizi
 *   açıkça belirtmek için. Verilmezse backend appointment'ların en son
 *   pozitif batch'ini otomatik bulur.
 * - notes: kullanıcı açıklaması.
 */
export const RefundAppointmentsInputSchema = z.object({
  appointmentIds: z.array(z.number().int().positive()).min(1, 'En az 1 randevu seçmelisiniz.'),
  refundPayments: z
    .array(
      z.object({
        method: z.enum(['CASH', 'CARD', 'TRANSFER', 'OTHER']),
        amount: z.number().positive('Tutar 0 üzerinde olmalı.'),
      }),
    )
    .min(1, 'En az 1 iade kalemi gerekli.'),
  parentBatchId: z.number().int().positive().optional(),
  notes: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1).nullable().optional(),
});
export type RefundAppointmentsInput = z.infer<typeof RefundAppointmentsInputSchema>;

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
