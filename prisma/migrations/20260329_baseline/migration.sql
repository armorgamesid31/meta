-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'STAFF', 'MANAGER', 'RECEPTION', 'FINANCE');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CANCELLED', 'NO_SHOW', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('CUSTOMER', 'ADMIN', 'AUTOMATION');

-- CreateEnum
CREATE TYPE "AppointmentMessageEventType" AS ENUM ('CONFIRMATION', 'REMINDER', 'CANCELLATION', 'SATISFACTION_SURVEY');

-- CreateEnum
CREATE TYPE "CustomerGender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "MagicLinkType" AS ENUM ('BOOKING', 'RESCHEDULE');

-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('INTERNAL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "TestimonialTemplateType" AS ENUM ('CATEGORY_EXPERT', 'EXPERT_ONLY', 'CATEGORY_ONLY', 'GENERIC');

-- CreateEnum
CREATE TYPE "LocaleCode" AS ENUM ('tr', 'en', 'es', 'fr', 'de', 'pt', 'ru', 'zh', 'ar', 'hi');

-- CreateEnum
CREATE TYPE "TranslationEntityType" AS ENUM ('SALON', 'CATEGORY', 'EXPERT', 'TEMPLATE', 'UI');

-- CreateEnum
CREATE TYPE "TranslationStatus" AS ENUM ('DRAFT', 'REVIEWED', 'APPROVED');

-- CreateEnum
CREATE TYPE "ContentSurface" AS ENUM ('marketing_site', 'salon_website', 'booking_page', 'mobile_app', 'campaigns', 'legal', 'message_templates');

-- CreateEnum
CREATE TYPE "ContentValueStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('WHATSAPP', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "InboundMessageStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ConversationAutomationMode" AS ENUM ('AUTO', 'HUMAN_PENDING', 'HUMAN_ACTIVE', 'MANUAL_ALWAYS', 'AUTO_RESUME_PENDING');

-- CreateEnum
CREATE TYPE "OutboundMessageSource" AS ENUM ('AI_AGENT', 'HUMAN_APP');

-- CreateTable
CREATE TABLE "Salon" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "logoUrl" TEXT,
    "chakraPluginId" TEXT,
    "chakraPhoneNumberId" TEXT,
    "city" TEXT,
    "citySlug" TEXT,
    "district" TEXT,
    "districtSlug" TEXT,
    "countryCode" TEXT,
    "tagline" TEXT,
    "about" TEXT,
    "heroImageUrl" TEXT,
    "instagramUrl" TEXT,
    "whatsappPhone" TEXT,
    "bookingMode" "BookingMode" DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "slug" TEXT,

    CONSTRAINT "Salon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonSettings" (
    "id" SERIAL NOT NULL,
    "workStartHour" INTEGER NOT NULL DEFAULT 9,
    "workEndHour" INTEGER NOT NULL DEFAULT 18,
    "slotInterval" INTEGER NOT NULL DEFAULT 30,
    "workingDays" JSONB,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "contentSourceLocale" "LocaleCode" NOT NULL DEFAULT 'tr',
    "categoryOrder" JSONB,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "salonId" INTEGER NOT NULL,

    CONSTRAINT "SalonSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonAiAgentSettings" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'balanced',
    "answerLength" TEXT NOT NULL DEFAULT 'medium',
    "emojiUsage" TEXT NOT NULL DEFAULT 'low',
    "bookingGuidance" TEXT NOT NULL DEFAULT 'medium',
    "handoverThreshold" TEXT NOT NULL DEFAULT 'balanced',
    "aiDisclosure" TEXT NOT NULL DEFAULT 'onQuestion',
    "faqAnswers" JSONB,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalonAiAgentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonUser" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "salonId" INTEGER NOT NULL,

    CONSTRAINT "SalonUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileAuthSession" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "salonId" INTEGER NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(6) NOT NULL,
    "revokedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileAuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "bio" TEXT,
    "themeColor" TEXT,
    "profileImageUrl" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "salonId" INTEGER NOT NULL,
    "userId" INTEGER,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Leave" (
    "id" SERIAL NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "staffId" INTEGER NOT NULL,

    CONSTRAINT "Leave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN DEFAULT true,
    "price" DOUBLE PRECISION NOT NULL,
    "duration" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "salonId" INTEGER NOT NULL,
    "category" TEXT,
    "requiresSpecialist" BOOLEAN DEFAULT false,
    "categoryId" INTEGER,
    "regionId" INTEGER,
    "serviceGroupId" INTEGER,
    "capacityOverride" INTEGER,
    "sequentialOverride" BOOLEAN,
    "bufferOverride" INTEGER,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceGroup" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN DEFAULT true,
    "displayOrder" INTEGER,
    "capacity" INTEGER DEFAULT 1,
    "sequentialRequired" BOOLEAN DEFAULT false,
    "preparationMinutes" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" SERIAL NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerId" INTEGER,
    "startTime" TIMESTAMP(6) NOT NULL,
    "endTime" TIMESTAMP(6) NOT NULL,
    "status" "AppointmentStatus" DEFAULT 'BOOKED',
    "source" "AppointmentSource" DEFAULT 'CUSTOMER',
    "notes" TEXT,
    "customerRating" INTEGER,
    "customerReview" TEXT,
    "customerReviewedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "salonId" INTEGER NOT NULL,
    "staffId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "gender" "CustomerGender" NOT NULL DEFAULT 'female',

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchContext" (
    "id" TEXT NOT NULL,
    "salonId" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicLink" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "type" "MagicLinkType" NOT NULL,
    "context" JSONB,
    "expiresAt" TIMESTAMP(6) NOT NULL,
    "usedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "instagram" TEXT,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "salonId" INTEGER NOT NULL,
    "gender" "CustomerGender",
    "birthDate" DATE,
    "acceptMarketing" BOOLEAN DEFAULT false,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerBehaviorLog" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "salonId" INTEGER NOT NULL,
    "appointmentId" INTEGER,
    "action" TEXT NOT NULL,
    "behaviorType" TEXT,
    "severityScore" DOUBLE PRECISION,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerBehaviorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerRiskProfile" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "salonId" INTEGER NOT NULL,
    "riskScore" DOUBLE PRECISION DEFAULT 0,
    "riskLevel" TEXT,
    "noShowCount" INTEGER DEFAULT 0,
    "noShows" INTEGER DEFAULT 0,
    "lastMinuteCount" INTEGER DEFAULT 0,
    "lastMinuteCancellations" INTEGER DEFAULT 0,
    "totalBookings" INTEGER DEFAULT 0,
    "lastCalculatedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerRiskProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonRiskConfig" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "isEnabled" BOOLEAN DEFAULT false,
    "lastMinuteHoursThreshold" INTEGER DEFAULT 24,
    "noShowPenalty" DOUBLE PRECISION DEFAULT 0.1,
    "lastMinutePenalty" DOUBLE PRECISION DEFAULT 0.05,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalonRiskConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceStats" (
    "serviceId" INTEGER NOT NULL,
    "minPrice" DOUBLE PRECISION NOT NULL,
    "maxPrice" DOUBLE PRECISION NOT NULL,
    "minDuration" INTEGER NOT NULL,
    "maxDuration" INTEGER NOT NULL,
    "calculatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "salonId" INTEGER NOT NULL,
    "gender" "CustomerGender" NOT NULL DEFAULT 'female',

    CONSTRAINT "ServiceStats_pkey" PRIMARY KEY ("serviceId","salonId","gender")
);

-- CreateTable
CREATE TABLE "StaffService" (
    "id" SERIAL NOT NULL,
    "staffId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "duration" INTEGER NOT NULL,
    "isactive" BOOLEAN DEFAULT true,
    "gender" "CustomerGender" NOT NULL DEFAULT 'female',

    CONSTRAINT "StaffService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffWorkingHours" (
    "id" SERIAL NOT NULL,
    "staffId" INTEGER NOT NULL,
    "dayOfWeek" INTEGER,
    "startHour" INTEGER NOT NULL,
    "endHour" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffWorkingHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "salonId" INTEGER NOT NULL,
    "categoryId" INTEGER,
    "isActive" BOOLEAN DEFAULT true,
    "marketingDescription" TEXT,
    "icon" TEXT,
    "coverImageUrl" TEXT,
    "displayOrder" INTEGER,
    "capacity" INTEGER DEFAULT 1,
    "sequentialRequired" BOOLEAN DEFAULT false,
    "bufferMinutes" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRegion" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" INTEGER,
    "isActive" BOOLEAN DEFAULT true,
    "displayOrder" INTEGER,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonGalleryImage" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "altText" TEXT,
    "displayOrder" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalonGalleryImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonTestimonial" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "expertId" INTEGER,
    "categoryId" INTEGER,
    "templateType" "TestimonialTemplateType",
    "generatedText" TEXT NOT NULL,
    "isGenerated" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalonTestimonial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'adet',
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "minStock" INTEGER NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION,
    "supplier" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "inventoryItemId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(6),
    "endsAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" JSONB,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentMessageDispatch" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "appointmentId" INTEGER NOT NULL,
    "eventType" "AppointmentMessageEventType" NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "recipientPhone" TEXT NOT NULL,
    "templateName" TEXT,
    "providerMessageId" TEXT,
    "providerPayload" JSONB,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentMessageDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonMessageTemplate" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "eventType" "AppointmentMessageEventType" NOT NULL,
    "locale" "LocaleCode" NOT NULL DEFAULT 'tr',
    "sessionText" TEXT,
    "templateName" TEXT,
    "templateContent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalonMessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsPreset" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlacklistEntry" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "phone" TEXT,
    "fullName" TEXT,
    "reason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,

    CONSTRAINT "BlacklistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "defaultName" TEXT NOT NULL,
    "defaultSlug" TEXT NOT NULL,
    "defaultDescription" TEXT,
    "defaultImageUrl" TEXT,
    "displayOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Translation" (
    "id" SERIAL NOT NULL,
    "entityType" "TranslationEntityType" NOT NULL,
    "entityId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "locale" "LocaleCode" NOT NULL,
    "sourceLocale" "LocaleCode" NOT NULL,
    "text" TEXT NOT NULL,
    "status" "TranslationStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Translation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" SERIAL NOT NULL,
    "surface" "ContentSurface" NOT NULL,
    "page" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "salonId" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentLocaleValue" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "locale" "LocaleCode" NOT NULL,
    "draftValue" TEXT NOT NULL,
    "publishedValue" TEXT,
    "status" "ContentValueStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(6),
    "publishedBy" INTEGER,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentLocaleValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceTranslation" (
    "id" SERIAL NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "locale" "LocaleCode" NOT NULL,
    "sourceLocale" "LocaleCode" NOT NULL DEFAULT 'tr',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "TranslationStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceGroupTranslation" (
    "id" SERIAL NOT NULL,
    "serviceGroupId" INTEGER NOT NULL,
    "locale" "LocaleCode" NOT NULL,
    "sourceLocale" "LocaleCode" NOT NULL DEFAULT 'tr',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "TranslationStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceGroupTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonChannelBinding" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalonChannelBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundMessageQueue" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "conversationKey" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "customerName" TEXT,
    "messageType" TEXT NOT NULL,
    "text" TEXT,
    "eventTimestamp" TIMESTAMP(6) NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "status" "InboundMessageStatus" NOT NULL DEFAULT 'PENDING',
    "batchId" TEXT,
    "processedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundMessageQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationState" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "conversationKey" TEXT NOT NULL,
    "canonicalUserId" TEXT,
    "customerId" INTEGER,
    "mode" "ConversationAutomationMode" NOT NULL DEFAULT 'AUTO',
    "humanPendingSince" TIMESTAMP(6),
    "humanActiveUntil" TIMESTAMP(6),
    "lastHumanMessageAt" TIMESTAMP(6),
    "lastCustomerMessageAt" TIMESTAMP(6),
    "manualAlways" BOOLEAN NOT NULL DEFAULT false,
    "profileName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessageTrace" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "conversationKey" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "canonicalUserId" TEXT,
    "customerId" INTEGER,
    "source" "OutboundMessageSource" NOT NULL,
    "text" TEXT,
    "sentAt" TIMESTAMP(6) NOT NULL,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundMessageTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceGender" (
    "serviceId" INTEGER NOT NULL,
    "gender" "CustomerGender" NOT NULL,

    CONSTRAINT "ServiceGender_pkey" PRIMARY KEY ("serviceId","gender")
);

-- CreateTable
CREATE TABLE "StaffServiceCustomSlot" (
    "id" SERIAL NOT NULL,
    "staffServiceId" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TIME(6) NOT NULL,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffServiceCustomSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "salon_slug_unique" ON "Salon"("slug");

-- CreateIndex
CREATE INDEX "idx_salon_city_district_slug" ON "Salon"("citySlug", "districtSlug");

-- CreateIndex
CREATE UNIQUE INDEX "SalonSettings_salonId_key" ON "SalonSettings"("salonId");

-- CreateIndex
CREATE UNIQUE INDEX "SalonAiAgentSettings_salonId_key" ON "SalonAiAgentSettings"("salonId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_mobile_auth_refresh_token_hash" ON "MobileAuthSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "idx_mobile_auth_user_salon" ON "MobileAuthSession"("userId", "salonId");

-- CreateIndex
CREATE INDEX "idx_mobile_auth_salon_expires" ON "MobileAuthSession"("salonId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Service_name_salonId_key" ON "Service"("name", "salonId");

-- CreateIndex
CREATE INDEX "idx_service_group_salon_display_order" ON "ServiceGroup"("salonId", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "uq_service_group_name_per_salon" ON "ServiceGroup"("salonId", "name");

-- CreateIndex
CREATE INDEX "idx_appointment_salon_start" ON "Appointment"("salonId", "startTime");

-- CreateIndex
CREATE INDEX "idx_appointment_salon_status_start" ON "Appointment"("salonId", "status", "startTime");

-- CreateIndex
CREATE INDEX "idx_staff_time" ON "Appointment"("staffId", "startTime", "endTime");

-- CreateIndex
CREATE UNIQUE INDEX "MagicLink_token_key" ON "MagicLink"("token");

-- CreateIndex
CREATE INDEX "idx_customer_salon_created" ON "Customer"("salonId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_salonId_key" ON "Customer"("phone", "salonId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRiskProfile_customerId_salonId_key" ON "CustomerRiskProfile"("customerId", "salonId");

-- CreateIndex
CREATE UNIQUE INDEX "SalonRiskConfig_salonId_key" ON "SalonRiskConfig"("salonId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffService_staff_service_gender_key" ON "StaffService"("staffId", "serviceId", "gender");

-- CreateIndex
CREATE INDEX "idx_servicecategory_salon_display_order" ON "ServiceCategory"("salonId", "displayOrder");

-- CreateIndex
CREATE INDEX "idx_servicecategory_salon_category_display" ON "ServiceCategory"("salonId", "categoryId", "displayOrder");

-- CreateIndex
CREATE INDEX "idx_service_region_salon_display_order" ON "ServiceRegion"("salonId", "displayOrder");

-- CreateIndex
CREATE INDEX "idx_service_region_salon_category" ON "ServiceRegion"("salonId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_service_region_name_per_salon" ON "ServiceRegion"("salonId", "name");

-- CreateIndex
CREATE INDEX "idx_gallery_salon_display_order" ON "SalonGalleryImage"("salonId", "displayOrder");

-- CreateIndex
CREATE INDEX "idx_testimonial_salon" ON "SalonTestimonial"("salonId");

-- CreateIndex
CREATE INDEX "idx_testimonial_expert" ON "SalonTestimonial"("expertId");

-- CreateIndex
CREATE INDEX "idx_testimonial_category" ON "SalonTestimonial"("categoryId");

-- CreateIndex
CREATE INDEX "idx_inventory_item_salon_active" ON "InventoryItem"("salonId", "isActive");

-- CreateIndex
CREATE INDEX "idx_inventory_movement_salon_item_created" ON "InventoryMovement"("salonId", "inventoryItemId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_campaign_salon_type_active" ON "Campaign"("salonId", "type", "isActive");

-- CreateIndex
CREATE INDEX "idx_automation_rule_salon_enabled" ON "AutomationRule"("salonId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "uq_automation_rule_salon_key" ON "AutomationRule"("salonId", "key");

-- CreateIndex
CREATE INDEX "idx_msg_dispatch_salon_created" ON "AppointmentMessageDispatch"("salonId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_msg_dispatch_event_created" ON "AppointmentMessageDispatch"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_msg_dispatch_salon_appointment_event" ON "AppointmentMessageDispatch"("salonId", "appointmentId", "eventType");

-- CreateIndex
CREATE INDEX "idx_salon_message_template_salon_active" ON "SalonMessageTemplate"("salonId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "uq_salon_message_template" ON "SalonMessageTemplate"("salonId", "eventType", "locale");

-- CreateIndex
CREATE INDEX "idx_analytics_preset_salon" ON "AnalyticsPreset"("salonId");

-- CreateIndex
CREATE INDEX "idx_blacklist_salon_active" ON "BlacklistEntry"("salonId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "uq_category_key" ON "Category"("key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_category_default_slug" ON "Category"("defaultSlug");

-- CreateIndex
CREATE INDEX "idx_translation_lookup" ON "Translation"("entityType", "entityId", "key", "locale", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_translation_entity_key_locale_version" ON "Translation"("entityType", "entityId", "key", "locale", "version");

-- CreateIndex
CREATE INDEX "idx_content_item_surface_page_salon" ON "ContentItem"("surface", "page", "salonId");

-- CreateIndex
CREATE INDEX "idx_content_item_surface_page_section" ON "ContentItem"("surface", "page", "section");

-- CreateIndex
CREATE INDEX "idx_content_locale_value_locale_status_version" ON "ContentLocaleValue"("locale", "status", "version");

-- CreateIndex
CREATE UNIQUE INDEX "uq_content_locale_value_item_locale" ON "ContentLocaleValue"("itemId", "locale");

-- CreateIndex
CREATE INDEX "idx_service_translation_lookup" ON "ServiceTranslation"("serviceId", "locale", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_service_translation_service_locale_version" ON "ServiceTranslation"("serviceId", "locale", "version");

-- CreateIndex
CREATE INDEX "idx_service_group_translation_lookup" ON "ServiceGroupTranslation"("serviceGroupId", "locale", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_service_group_translation_group_locale_version" ON "ServiceGroupTranslation"("serviceGroupId", "locale", "version");

-- CreateIndex
CREATE INDEX "idx_salon_channel_binding_salon_channel_active" ON "SalonChannelBinding"("salonId", "channel", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "uq_salon_channel_external_account" ON "SalonChannelBinding"("channel", "externalAccountId");

-- CreateIndex
CREATE INDEX "idx_inbound_salon_conv_status_created" ON "InboundMessageQueue"("salonId", "channel", "conversationKey", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_inbound_aggregate_window" ON "InboundMessageQueue"("salonId", "channel", "conversationKey", "status", "eventTimestamp");

-- CreateIndex
CREATE INDEX "idx_inbound_status_created" ON "InboundMessageQueue"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_inbound_channel_provider_message" ON "InboundMessageQueue"("channel", "providerMessageId");

-- CreateIndex
CREATE INDEX "idx_conversation_state_salon_mode_updated" ON "ConversationState"("salonId", "mode", "updatedAt");

-- CreateIndex
CREATE INDEX "idx_conversation_state_canonical" ON "ConversationState"("canonicalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_conversation_state_salon_channel_key" ON "ConversationState"("salonId", "channel", "conversationKey");

-- CreateIndex
CREATE INDEX "idx_outbound_trace_salon_conv_sent" ON "OutboundMessageTrace"("salonId", "channel", "conversationKey", "sentAt");

-- CreateIndex
CREATE INDEX "idx_outbound_trace_source_sent" ON "OutboundMessageTrace"("source", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_outbound_trace_channel_provider_message" ON "OutboundMessageTrace"("channel", "providerMessageId");

-- AddForeignKey
ALTER TABLE "SalonSettings" ADD CONSTRAINT "SalonSettings_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonAiAgentSettings" ADD CONSTRAINT "SalonAiAgentSettings_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonUser" ADD CONSTRAINT "SalonUser_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MobileAuthSession" ADD CONSTRAINT "MobileAuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SalonUser"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MobileAuthSession" ADD CONSTRAINT "MobileAuthSession_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Leave" ADD CONSTRAINT "Leave_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "ServiceRegion"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_serviceGroupId_fkey" FOREIGN KEY ("serviceGroupId") REFERENCES "ServiceGroup"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ServiceGroup" ADD CONSTRAINT "ServiceGroup_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ServiceStats" ADD CONSTRAINT "ServiceStats_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StaffService" ADD CONSTRAINT "StaffService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StaffService" ADD CONSTRAINT "StaffService_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StaffWorkingHours" ADD CONSTRAINT "StaffWorkingHours_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ServiceRegion" ADD CONSTRAINT "ServiceRegion_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ServiceRegion" ADD CONSTRAINT "ServiceRegion_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonGalleryImage" ADD CONSTRAINT "SalonGalleryImage_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonTestimonial" ADD CONSTRAINT "SalonTestimonial_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonTestimonial" ADD CONSTRAINT "SalonTestimonial_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonTestimonial" ADD CONSTRAINT "SalonTestimonial_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentMessageDispatch" ADD CONSTRAINT "AppointmentMessageDispatch_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentMessageDispatch" ADD CONSTRAINT "AppointmentMessageDispatch_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonMessageTemplate" ADD CONSTRAINT "SalonMessageTemplate_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AnalyticsPreset" ADD CONSTRAINT "AnalyticsPreset_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BlacklistEntry" ADD CONSTRAINT "BlacklistEntry_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ContentLocaleValue" ADD CONSTRAINT "ContentLocaleValue_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ContentLocaleValue" ADD CONSTRAINT "ContentLocaleValue_publishedBy_fkey" FOREIGN KEY ("publishedBy") REFERENCES "SalonUser"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ServiceTranslation" ADD CONSTRAINT "ServiceTranslation_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ServiceGroupTranslation" ADD CONSTRAINT "ServiceGroupTranslation_serviceGroupId_fkey" FOREIGN KEY ("serviceGroupId") REFERENCES "ServiceGroup"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonChannelBinding" ADD CONSTRAINT "SalonChannelBinding_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "InboundMessageQueue" ADD CONSTRAINT "InboundMessageQueue_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ConversationState" ADD CONSTRAINT "ConversationState_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OutboundMessageTrace" ADD CONSTRAINT "OutboundMessageTrace_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ServiceGender" ADD CONSTRAINT "ServiceGender_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StaffServiceCustomSlot" ADD CONSTRAINT "fk_staffservice" FOREIGN KEY ("staffServiceId") REFERENCES "StaffService"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

