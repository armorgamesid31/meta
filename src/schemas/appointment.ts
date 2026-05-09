import { z } from 'zod';

export const PaymentMethodSchema = z.enum(['CASH', 'CARD', 'TRANSFER', 'OTHER']);

const ServiceSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  duration: z.number().int(),
  price: z.number(),
  requiresSpecialist: z.boolean().optional(),
});

const StaffSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  title: z.string().nullable().optional(),
});

export const AppointmentLineSchema = z.object({
  id: z.number().int(),
  appointmentId: z.number().int(),
  serviceId: z.number().int(),
  specialistId: z.number().int().nullable().optional(),
  status: z.string(),
  orderIndex: z.number().int().optional(),
  paymentMethod: PaymentMethodSchema.nullable().optional(),
  paymentRecordedAt: z.string().nullable().optional(),
  service: ServiceSummarySchema.nullable().optional(),
  specialist: StaffSummarySchema.nullable().optional(),
});

export const AdminAppointmentItemSchema = z.object({
  id: z.number().int(),
  customerId: z.number().int().nullable().optional(),
  startTime: z.string(),
  endTime: z.string(),
  status: z.string(),
  paymentMethod: PaymentMethodSchema.nullable().optional(),
  paymentRecordedAt: z.string().nullable().optional(),
  customerName: z.string(),
  customerPhone: z.string(),
  service: ServiceSummarySchema,
  staff: StaffSummarySchema,
  appointmentLines: z.array(AppointmentLineSchema).optional(),
  createdAt: z.string(),
});
export type AdminAppointmentItem = z.infer<typeof AdminAppointmentItemSchema>;

export const AdminAppointmentsResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  serverNow: z.string(),
  dayResolved: z.string(),
  items: z.array(AdminAppointmentItemSchema),
  count: z.number().int(),
});
export type AdminAppointmentsResponse = z.infer<typeof AdminAppointmentsResponseSchema>;
