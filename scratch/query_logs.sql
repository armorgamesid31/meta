SELECT id, "salonId", "eventType", "payload" FROM "MetaChannelWebhookLog" WHERE "eventType" = 'processing_result' ORDER BY "createdAt" DESC LIMIT 5;
