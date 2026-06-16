import { z } from 'zod';

export const MobileRoleSchema = z.enum(['OWNER', 'MANAGER', 'STAFF', 'RECEPTION', 'FINANCE']);
export type MobileRole = z.infer<typeof MobileRoleSchema>;

export const OnboardingStepSchema = z.enum([
  'NOT_STARTED',
  'WELCOME',
  'SALON_NAME',
  'SLUG',
  'ADDRESS',
  'PHONE',
  'WORKING_HOURS',
  'LOGO',
  'GALLERY',
  'SERVICES',
  'TONE',
  'COMPLETED',
]);
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;

export const BootstrapResponseSchema = z.object({
  user: z.object({
    id: z.number().int(),
    name: z.string(),
    role: MobileRoleSchema,
  }),
  salon: z.object({
    id: z.number().int(),
    name: z.string(),
    slug: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
    whatsappPhone: z.string().nullable().optional(),
    onboardingStep: OnboardingStepSchema.optional(),
    onboardingSkipped: z.array(z.string()).optional(),
    category: z.string().nullable().optional(),
    logoUrl: z.string().nullable().optional(),
    kurulumScore: z.number().int().optional(),
    kurulumStage: z.string().nullable().optional(),
    // ISO-8601 string. Drives F5 WhatsAppNudgeBanner age threshold (>3 days).
    createdAt: z.string().nullable().optional(),
    // Salon silme zamanlandıysa ISO; DeletionScheduledBanner + SalonDangerZone okur.
    // Şemada YOKTU → app `as any` ile okuyordu; şema doğrulaması eklenirse sessizce
    // silinip banner kaybolacaktı (saatli bomba). Sözleşmeye eklendi.
    deletionScheduledAt: z.string().nullable().optional(),
  }),
  capabilities: z.record(z.string(), z.union([z.boolean(), z.string()])),
  featureFlags: z.record(z.string(), z.boolean()),
  permissions: z.array(z.string()).optional(),
  accessVersion: z.number().int().optional(),
  subscription: z.object({
    plan: z.string(),
    status: z.string(),
  }),
  features: z.array(z.string()).optional(),
  setupChecklist: z
    .object({
      workingHours: z.boolean(),
      address: z.boolean(),
      phone: z.boolean(),
      service: z.boolean(),
      staff: z.boolean(),
      completed: z.boolean(),
    })
    .optional(),
  setup: z
    .object({
      workStartHour: z.number().nullable(),
      workEndHour: z.number().nullable(),
      slotInterval: z.number().nullable(),
      workingDays: z.array(z.string()).nullable(),
    })
    .optional(),
  staffProfile: z
    .object({
      linkedStaffId: z.number().int().nullable(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      gender: z.enum(['female', 'male', 'other']).nullable(),
      // Kimliğe bağlı profil fotoğrafı (route döndürüyor; şemada eksikti).
      profileImageUrl: z.string().nullable().optional(),
      completionRequired: z.boolean(),
    })
    .optional(),
  // Route notifications.defaults döndürüyor (varsayılan bildirim politikası).
  notifications: z.object({ defaults: z.unknown() }).optional(),
});
export type BootstrapResponse = z.infer<typeof BootstrapResponseSchema>;
