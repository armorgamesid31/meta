import { z } from 'zod';

export const ChannelTypeSchema = z.enum(['INSTAGRAM', 'WHATSAPP']);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

export const AutomationModeSchema = z.enum([
  'AUTO',
  'HUMAN_PENDING',
  'HUMAN_ACTIVE',
  'MANUAL_ALWAYS',
  'AUTO_RESUME_PENDING',
]);
export type AutomationMode = z.infer<typeof AutomationModeSchema>;

export const ConversationItemSchema = z.object({
  channel: ChannelTypeSchema,
  conversationKey: z.string(),
  customerName: z.string().nullable(),
  profileUsername: z.string().nullable().optional(),
  profilePicUrl: z.string().nullable().optional(),
  lastMessageType: z.string(),
  lastMessageText: z.string().nullable(),
  lastEventTimestamp: z.string(),
  unreadCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  hasHandoverRequest: z.boolean(),
  identityLinked: z.boolean().optional(),
  linkedCustomerId: z.number().int().nullable().optional(),
  automationMode: AutomationModeSchema.optional(),
  manualAlways: z.boolean().optional(),
  humanPendingSince: z.string().nullable().optional(),
  humanActiveUntil: z.string().nullable().optional(),
  lastHumanMessageAt: z.string().nullable().optional(),
  lastCustomerMessageAt: z.string().nullable().optional(),
});
export type ConversationItem = z.infer<typeof ConversationItemSchema>;

const InstagramChannelHealthSchema = z.object({
  connected: z.boolean(),
  status: z.string(),
  message: z.string(),
  bindingReady: z.boolean(),
  missingRequirements: z.array(z.string()).optional(),
});

const WhatsAppChannelHealthSchema = z.object({
  connected: z.boolean(),
  isActive: z.boolean(),
  hasPlugin: z.boolean(),
  whatsappPhoneNumberId: z.string().nullable().optional(),
  message: z.string(),
  missingRequirements: z.array(z.string()).optional(),
});

export const ChannelHealthPayloadSchema = z.object({
  instagram: InstagramChannelHealthSchema,
  whatsapp: WhatsAppChannelHealthSchema,
});
export type ChannelHealthPayload = z.infer<typeof ChannelHealthPayloadSchema>;

export const ConversationsListResponseSchema = z.object({
  items: z.array(ConversationItemSchema),
  channelHealth: ChannelHealthPayloadSchema.optional(),
});
export type ConversationsListResponse = z.infer<typeof ConversationsListResponseSchema>;
