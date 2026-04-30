-- Payment fields on Appointment
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'OTHER');
ALTER TABLE "Appointment"
  ADD COLUMN "paymentMethod" "PaymentMethod",
  ADD COLUMN "paymentRecordedAt" TIMESTAMP(6);

-- Notification enums
CREATE TYPE "NotificationEventType" AS ENUM (
  'HANDOVER_REQUIRED',
  'HANDOVER_REMINDER',
  'SAME_DAY_APPOINTMENT_CHANGE',
  'END_OF_DAY_MISSING_DATA',
  'DAILY_MANAGER_REPORT'
);

CREATE TYPE "NotificationDeliveryChannel" AS ENUM ('IN_APP', 'PUSH');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');
CREATE TYPE "HandoverAlertLifecycleState" AS ENUM ('ACTIVE', 'RESOLVED', 'EXPIRED');

-- Device token registry
CREATE TABLE "PushDeviceToken" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "platform" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "appVersion" TEXT,
  "deviceMeta" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(6),
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushDeviceToken_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "PushDeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SalonUser"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Per-user preferences
CREATE TABLE "UserNotificationPreference" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "masterEnabled" BOOLEAN NOT NULL DEFAULT true,
  "eventConfig" JSONB,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserNotificationPreference_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "UserNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SalonUser"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Notification payload records
CREATE TABLE "AppNotification" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "eventType" "NotificationEventType" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(6),
  CONSTRAINT "AppNotification_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Fan-out deliveries per user/channel
CREATE TABLE "AppNotificationDelivery" (
  "id" SERIAL PRIMARY KEY,
  "notificationId" INTEGER NOT NULL,
  "salonId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "pushTokenId" INTEGER,
  "channel" "NotificationDeliveryChannel" NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "providerMessageId" TEXT,
  "failureReason" TEXT,
  "readAt" TIMESTAMP(6),
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppNotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "AppNotification"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "AppNotificationDelivery_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "AppNotificationDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SalonUser"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "AppNotificationDelivery_pushTokenId_fkey" FOREIGN KEY ("pushTokenId") REFERENCES "PushDeviceToken"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

-- Handover reminder lifecycle
CREATE TABLE "HandoverAlertState" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "channel" "ChannelType" NOT NULL,
  "conversationKey" TEXT NOT NULL,
  "state" "HandoverAlertLifecycleState" NOT NULL DEFAULT 'ACTIVE',
  "repeatCount" INTEGER NOT NULL DEFAULT 0,
  "firstTriggeredAt" TIMESTAMP(6),
  "lastTriggeredAt" TIMESTAMP(6),
  "lastHumanMessageAt" TIMESTAMP(6),
  "stoppedAt" TIMESTAMP(6),
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HandoverAlertState_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Indexes
CREATE UNIQUE INDEX "uq_push_device_platform_token" ON "PushDeviceToken"("platform", "token");
CREATE INDEX "idx_push_device_salon_user_active" ON "PushDeviceToken"("salonId", "userId", "isActive");

CREATE UNIQUE INDEX "uq_user_notification_pref_salon_user" ON "UserNotificationPreference"("salonId", "userId");

CREATE INDEX "idx_app_notification_salon_created" ON "AppNotification"("salonId", "createdAt");

CREATE INDEX "idx_notification_delivery_notification" ON "AppNotificationDelivery"("notificationId");
CREATE INDEX "idx_notification_delivery_user_read" ON "AppNotificationDelivery"("salonId", "userId", "readAt");

CREATE UNIQUE INDEX "uq_handover_alert_salon_channel_key" ON "HandoverAlertState"("salonId", "channel", "conversationKey");
CREATE INDEX "idx_handover_alert_state_updated" ON "HandoverAlertState"("state", "updatedAt");
