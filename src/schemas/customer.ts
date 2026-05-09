import { z } from 'zod';

export const AdminCustomerItemSchema = z.object({
  id: z.number().int(),
  name: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  phone: z.string(),
  instagram: z.string().nullable(),
  gender: z.string().nullable(),
  birthDate: z.string().nullable(),
  acceptMarketing: z.boolean().nullable(),
  appointmentCount: z.number().int().nonnegative().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AdminCustomerItem = z.infer<typeof AdminCustomerItemSchema>;

export const CreateAdminCustomerInputSchema = z.object({
  firstName: z.string().trim().min(1, 'Ad zorunludur.'),
  lastName: z.string().trim().min(1, 'Soyad zorunludur.'),
  name: z.string().trim().min(1, 'İsim zorunludur.').optional(),
  phone: z.string().trim().min(4, 'Geçerli bir telefon zorunludur.'),
  instagram: z.string().trim().min(1).nullable().optional(),
  birthDate: z.string().trim().min(1).nullable().optional(),
  acceptMarketing: z.boolean(),
});
export type CreateAdminCustomerInput = z.infer<typeof CreateAdminCustomerInputSchema>;

export const CreateAdminCustomerResponseSchema = z.object({
  customer: AdminCustomerItemSchema,
});
export type CreateAdminCustomerResponse = z.infer<typeof CreateAdminCustomerResponseSchema>;

export const AdminCustomersListResponseSchema = z.object({
  items: z.array(AdminCustomerItemSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type AdminCustomersListResponse = z.infer<typeof AdminCustomersListResponseSchema>;
