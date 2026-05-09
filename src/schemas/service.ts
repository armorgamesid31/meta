import { z } from 'zod';

export const ServiceItemSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  duration: z.number().int(),
  price: z.number(),
  requiresSpecialist: z.boolean().optional(),
});
export type ServiceItem = z.infer<typeof ServiceItemSchema>;

export const ServicesListResponseSchema = z.object({
  items: z.array(ServiceItemSchema),
});
export type ServicesListResponse = z.infer<typeof ServicesListResponseSchema>;

export const StaffItemSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  title: z.string().nullable().optional(),
});
export type StaffItem = z.infer<typeof StaffItemSchema>;

export const StaffListResponseSchema = z.object({
  items: z.array(StaffItemSchema),
});
export type StaffListResponse = z.infer<typeof StaffListResponseSchema>;
