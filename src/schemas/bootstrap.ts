import { z } from 'zod';

export const MobileRoleSchema = z.enum(['OWNER', 'MANAGER', 'STAFF', 'RECEPTION', 'FINANCE']);
export type MobileRole = z.infer<typeof MobileRoleSchema>;

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
  }),
  capabilities: z.record(z.string(), z.union([z.boolean(), z.string()])),
  featureFlags: z.record(z.string(), z.boolean()),
  permissions: z.array(z.string()).optional(),
  accessVersion: z.number().int().optional(),
  subscription: z.object({
    plan: z.string(),
    status: z.string(),
  }),
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
      completionRequired: z.boolean(),
    })
    .optional(),
});
export type BootstrapResponse = z.infer<typeof BootstrapResponseSchema>;
