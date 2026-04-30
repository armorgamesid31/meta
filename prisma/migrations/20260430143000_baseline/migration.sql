-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'STAFF', 'MANAGER', 'RECEPTION', 'FINANCE');

-- CreateEnum
CREATE TYPE "ChannelProfileFetchStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CANCELLED', 'NO_SHOW', 'COMPLETED', 'UPDATED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "AppointmentLineStatus" AS ENUM ('BOOKED', 'CANCELLED', 'NO_SHOW', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AppointmentPreferenceMode" AS ENUM ('ANY', 'SPECIFIC');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "PackageScopeType" AS ENUM ('SINGLE_SERVICE', 'POOL');

-- CreateEnum
CREATE TYPE "PackageSourceType" AS ENUM ('TEMPLATE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CustomerPackageStatus" AS ENUM ('ACTIVE', 'DEPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PackageActionType" AS ENUM ('ASSIGNED', 'AUTO_CONSUME', 'AUTO_RESTORE', 'MANUAL_ADJUST', 'SKIPPED_NO_ELIGIBLE_PACKAGE', 'SKIPPED_EXPIRED');

-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('HANDOVER_REQUIRED', 'HANDOVER_REMINDER', 'SAME_DAY_APPOINTMENT_CHANGE', 'END_OF_DAY_MISSING_DATA', 'DAILY_MANAGER_REPORT', 'CAMPAIGN_AUTO_TRIGGER', 'CAMPAIGN_MANUAL_SEND', 'WAITLIST_OFFER_CREATED', 'WAITLIST_OFFER_EXPIRED', 'WAITLIST_OFFER_ACCEPTED', 'WAITLIST_MATCH_FOUND');

-- CreateEnum
CREATE TYPE "CampaignDeliveryMode" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('BIRTHDAY', 'WINBACK', 'WELCOME_FIRST_VISIT', 'LOYALTY', 'MULTI_SERVICE_DISCOUNT', 'OFF_PEAK', 'REFERRAL');

-- CreateEnum
CREATE TYPE "CampaignLifecycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CampaignApplicationStatus" AS ENUM ('APPLIED', 'RELEASED');

-- CreateEnum
CREATE TYPE "CampaignEnrollmentStatus" AS ENUM ('ENROLLED', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "CampaignShareLinkStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CampaignAttributionStatus" AS ENUM ('PENDING', 'REGISTERED', 'QUALIFIED', 'REWARDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationDeliveryChannel" AS ENUM ('IN_APP', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('UPLOADING', 'PARSING', 'NEEDS_REVIEW', 'READY_TO_COMMIT', 'COMMITTING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportSourceType" AS ENUM ('CSV', 'EXCEL', 'PDF', 'IMAGE');

-- CreateEnum
CREATE TYPE "ImportSourceFileStatus" AS ENUM ('PENDING_UPLOAD', 'PARSING', 'WAITING_OCR', 'PARSED', 'FAILED_EXTRACTION');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('EXTRACTED', 'READY', 'CONFLICT', 'SKIPPED', 'IMPORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportConflictType" AS ENUM ('MISSING_PHONE', 'INVALID_PHONE', 'SERVICE_UNMATCHED', 'STAFF_UNMATCHED', 'APPOINTMENT_OVERLAP', 'OUT_OF_RANGE_DATE', 'VALIDATION_ERROR');

-- CreateEnum
CREATE TYPE "ImportConflictStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ImportCommitStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportExtractionMode" AS ENUM ('PRODUCTION', 'BENCHMARK');

-- CreateEnum
CREATE TYPE "ImportExtractionRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "WaitlistEntrySource" AS ENUM ('CUSTOMER', 'ADMIN');

-- CreateEnum
CREATE TYPE "WaitlistEntryStatus" AS ENUM ('PENDING', 'OFFERED', 'ACCEPTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WaitlistOfferChannel" AS ENUM ('WHATSAPP', 'WEB_LINK');

-- CreateEnum
CREATE TYPE "WaitlistOfferStatus" AS ENUM ('PENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HandoverAlertLifecycleState" AS ENUM ('ACTIVE', 'RESOLVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('CUSTOMER', 'ADMIN', 'AUTOMATION', 'IMPORT');

-- CreateEnum
CREATE TYPE "AppointmentMessageEventType" AS ENUM ('CONFIRMATION', 'REMINDER', 'CANCELLATION', 'SATISFACTION_SURVEY');

-- CreateEnum
CREATE TYPE "CustomerGender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "CustomerRegistrationStatus" AS ENUM ('PENDING', 'VERIFIED');

-- CreateEnum
CREATE TYPE "CustomerPhoneVerificationPurpose" AS ENUM ('BOOKING_REGISTER');

-- CreateEnum
CREATE TYPE "CustomerPhoneVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MagicLinkType" AS ENUM ('BOOKING', 'RESCHEDULE');

-- CreateEnum
CREATE TYPE "MagicLinkStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "IdentitySubjectType" AS ENUM ('PHONE', 'INSTAGRAM_ID');

-- CreateEnum
CREATE TYPE "IdentitySessionStatus" AS ENUM ('ACTIVE', 'LINKED', 'CLOSED');

-- CreateEnum
CREATE TYPE "IdentityBindingSource" AS ENUM ('MAGIC_LINK_REGISTER', 'ADMIN_MANUAL', 'SYSTEM');

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

-- CreateEnum
CREATE TYPE "MessageEventDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'SYSTEM');

-- CreateTable
CREATE TABLE "Salon" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "slug" TEXT,
    "chakraPluginId" TEXT,
    "tagline" TEXT,
    "about" TEXT,
    "heroImageUrl" TEXT,
    "instagramUrl" TEXT,
    "whatsappPhone" TEXT,
    "bookingMode" "BookingMode" DEFAULT 'INTERNAL',
    "city" TEXT,
    "citySlug" TEXT,
    "district" TEXT,
    "districtSlug" TEXT,
    "countryCode" TEXT,
    "address" TEXT,
    "googleMapsUrl" TEXT,
    "chakraPhoneNumberId" TEXT,
    "heroText" TEXT,

    CONSTRAINT "Salon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonSettings" (
    "id" SERIAL NOT NULL,
    "workStartHour" INTEGER NOT NULL DEFAULT 9,
    "workEndHour" INTEGER NOT NULL DEFAULT 18,
    "slotInterval" INTEGER NOT NULL DEFAULT 30,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "salonId" INTEGER NOT NULL,
    "categoryOrder" JSONB,
    "contentSourceLocale" "LocaleCode" NOT NULL DEFAULT 'tr',
    "workingDays" JSONB,
    "commonQuestions" JSONB,

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
    "faqAnswers" JSONB,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "aiDisclosure" TEXT NOT NULL DEFAULT 'onQuestion',

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
    "displayName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "passwordResetRequired" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(6),

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
    "phone" TEXT,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "salonId" INTEGER NOT NULL,
    "userId" INTEGER,
    "title" TEXT,
    "bio" TEXT,
    "profileImageUrl" TEXT,
    "themeColor" TEXT,

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
CREATE TABLE "SalonClosure" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "startAt" TIMESTAMP(6) NOT NULL,
    "endAt" TIMESTAMP(6) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalonClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTimeOff" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "staffId" INTEGER NOT NULL,
    "startAt" TIMESTAMP(6) NOT NULL,
    "endAt" TIMESTAMP(6) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffTimeOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "duration" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "salonId" INTEGER NOT NULL,
    "category" TEXT,
    "requiresSpecialist" BOOLEAN DEFAULT false,
    "categoryId" INTEGER,
    "capacityOverride" INTEGER,
    "sequentialOverride" BOOLEAN,
    "bufferOverride" INTEGER,
    "serviceGroupId" INTEGER,
    "isActive" BOOLEAN DEFAULT true,
    "regionId" INTEGER,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceGroup" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER,
    "capacity" INTEGER DEFAULT 1,
    "sequentialRequired" BOOLEAN DEFAULT false,
    "preparationMinutes" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN DEFAULT true,

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
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "salonId" INTEGER NOT NULL,
    "staffId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "gender" "CustomerGender" NOT NULL DEFAULT 'female',
    "customerRating" INTEGER,
    "customerReview" TEXT,
    "customerReviewedAt" TIMESTAMP(6),
    "paymentMethod" "PaymentMethod",
    "paymentRecordedAt" TIMESTAMP(6),
    "preferenceMode" "AppointmentPreferenceMode" DEFAULT 'ANY',
    "preferredStaffId" INTEGER,
    "rescheduledFromAppointmentId" INTEGER,
    "rescheduleBatchId" TEXT,
    "listPrice" DOUBLE PRECISION,
    "discountTotal" DOUBLE PRECISION,
    "finalPrice" DOUBLE PRECISION,
    "campaignSnapshot" JSONB,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentLine" (
    "id" SERIAL NOT NULL,
    "appointmentId" INTEGER NOT NULL,
    "salonId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "serviceId" INTEGER NOT NULL,
    "specialistId" INTEGER,
    "startTime" TIMESTAMP(6),
    "endTime" TIMESTAMP(6),
    "durationMinutes" INTEGER,
    "listPrice" DOUBLE PRECISION,
    "finalPrice" DOUBLE PRECISION,
    "status" "AppointmentLineStatus" DEFAULT 'BOOKED',
    "paymentMethod" "PaymentMethod",
    "paymentRecordedAt" TIMESTAMP(6),
    "regionInfo" JSONB,
    "groupInfo" JSONB,
    "notes" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentLine_pkey" PRIMARY KEY ("id")
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
    "salonId" INTEGER NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "subjectType" "IdentitySubjectType" NOT NULL,
    "subjectNormalized" TEXT NOT NULL,
    "status" "MagicLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "identitySessionId" TEXT NOT NULL,
    "usedByCustomerId" INTEGER,

    CONSTRAINT "MagicLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentitySession" (
    "id" TEXT NOT NULL,
    "salonId" INTEGER NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "subjectType" "IdentitySubjectType" NOT NULL,
    "subjectRaw" TEXT NOT NULL,
    "subjectNormalized" TEXT NOT NULL,
    "conversationKey" TEXT,
    "canonicalUserId" TEXT,
    "customerId" INTEGER,
    "status" "IdentitySessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastInboundAt" TIMESTAMP(6),
    "lastOutboundAt" TIMESTAMP(6),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentitySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityBinding" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "subjectNormalized" TEXT NOT NULL,
    "subjectRaw" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "sessionId" TEXT,
    "source" "IdentityBindingSource" NOT NULL DEFAULT 'SYSTEM',
    "verifiedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "salonId" INTEGER NOT NULL,
    "gender" "CustomerGender",
    "birthDate" DATE,
    "acceptMarketing" BOOLEAN DEFAULT false,
    "instagram" TEXT,
    "registrationStatus" "CustomerRegistrationStatus" NOT NULL DEFAULT 'VERIFIED',

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
    "description" TEXT,
    "regionId" INTEGER,
    "regionName" TEXT,

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
    "capacity" INTEGER DEFAULT 1,
    "sequentialRequired" BOOLEAN DEFAULT false,
    "bufferMinutes" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "marketingDescription" TEXT,
    "icon" TEXT,
    "displayOrder" INTEGER,
    "coverImageUrl" TEXT,
    "categoryId" INTEGER,
    "isActive" BOOLEAN DEFAULT true,
    "commonQuestions" JSONB,

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
    "categoryId" INTEGER,

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
    "type" "CampaignType" NOT NULL,
    "description" TEXT,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lifecycleStatus" "CampaignLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(6),
    "endsAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "deliveryMode" "CampaignDeliveryMode" NOT NULL DEFAULT 'MANUAL',
    "maxGlobalUsage" INTEGER,
    "maxPerCustomer" INTEGER,
    "publishedAt" TIMESTAMP(6),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSendExecution" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "executionKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "audienceSize" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignSendExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentCampaignApplication" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "appointmentId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "campaignId" INTEGER NOT NULL,
    "serviceId" INTEGER,
    "status" "CampaignApplicationStatus" NOT NULL DEFAULT 'APPLIED',
    "listPrice" DOUBLE PRECISION NOT NULL,
    "discountAmount" DOUBLE PRECISION NOT NULL,
    "finalPrice" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    "appliedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentCampaignApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCampaignWallet" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "balanceAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "consumedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(6),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerCampaignWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCampaignEnrollment" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "status" "CampaignEnrollmentStatus" NOT NULL DEFAULT 'ENROLLED',
    "source" TEXT,
    "metadata" JSONB,
    "enrolledAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerCampaignEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignShareLink" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "status" "CampaignShareLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "lastSharedAt" TIMESTAMP(6),
    "expiresAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignAttribution" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "shareLinkId" INTEGER NOT NULL,
    "referrerCustomerId" INTEGER NOT NULL,
    "referredCustomerId" INTEGER,
    "status" "CampaignAttributionStatus" NOT NULL DEFAULT 'PENDING',
    "firstAppointmentId" INTEGER,
    "completedAt" TIMESTAMP(6),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignAttribution_pkey" PRIMARY KEY ("id")
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
    "externalId" TEXT,
    "metaCategory" TEXT,
    "metaStatus" TEXT,
    "lastSyncAt" TIMESTAMP(6),

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
    "channel" "ChannelType",
    "subjectNormalized" TEXT,

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
CREATE TABLE "ConversationMessageEvent" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "conversationKey" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "customerName" TEXT,
    "messageType" TEXT NOT NULL,
    "text" TEXT,
    "direction" "MessageEventDirection" NOT NULL,
    "eventTimestamp" TIMESTAMP(6) NOT NULL,
    "processingStatus" "InboundMessageStatus" DEFAULT 'DONE',
    "outboundSource" "OutboundMessageSource",
    "outboundSenderUserId" INTEGER,
    "outboundSenderEmail" TEXT,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationThreadSummary" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "conversationKey" TEXT NOT NULL,
    "customerName" TEXT,
    "profileUsername" TEXT,
    "profilePicUrl" TEXT,
    "lastMessageType" TEXT NOT NULL,
    "lastMessageText" TEXT,
    "lastDirection" "MessageEventDirection" NOT NULL,
    "lastEventTimestamp" TIMESTAMP(6) NOT NULL,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "hasHandoverRequest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationThreadSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationRealtimeEvent" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "conversationKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "messageEventId" INTEGER,
    "eventTimestamp" TIMESTAMP(6) NOT NULL,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationRealtimeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaChannelWebhookLog" (
    "id" SERIAL NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'INBOUND',
    "eventType" TEXT,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "conversationKey" TEXT,
    "salonId" INTEGER,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaChannelWebhookLog_pkey" PRIMARY KEY ("id")
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
    "sourceUserEmail" TEXT,
    "sourceUserId" INTEGER,

    CONSTRAINT "OutboundMessageTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelProfileCache" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "subjectNormalized" TEXT NOT NULL,
    "subjectRaw" TEXT,
    "profileName" TEXT,
    "profileUsername" TEXT,
    "profilePicUrl" TEXT,
    "rawProfile" JSONB,
    "fetchStatus" "ChannelProfileFetchStatus" NOT NULL DEFAULT 'PENDING',
    "fetchAttempts" INTEGER NOT NULL DEFAULT 0,
    "fetchAttemptedAt" TIMESTAMP(6),
    "fetchedAt" TIMESTAMP(6),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelProfileCache_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "PackageTemplate" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "scopeType" "PackageScopeType" NOT NULL DEFAULT 'SINGLE_SERVICE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "price" DOUBLE PRECISION,
    "validityDays" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageTemplateService" (
    "id" SERIAL NOT NULL,
    "packageTemplateId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "initialQuota" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageTemplateService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPackage" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "packageTemplateId" INTEGER,
    "sourceType" "PackageSourceType" NOT NULL,
    "scopeType" "PackageScopeType" NOT NULL DEFAULT 'SINGLE_SERVICE',
    "status" "CustomerPackageStatus" NOT NULL DEFAULT 'ACTIVE',
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(6),
    "expiresAt" TIMESTAMP(6),
    "price" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPackageServiceBalance" (
    "id" SERIAL NOT NULL,
    "customerPackageId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "initialQuota" INTEGER NOT NULL,
    "remainingQuota" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPackageServiceBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageLedger" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "customerPackageId" INTEGER,
    "serviceId" INTEGER,
    "appointmentId" INTEGER,
    "actionType" "PackageActionType" NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "appointmentLineId" INTEGER,

    CONSTRAINT "PackageLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentPackageConsumption" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "appointmentId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "customerPackageId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "consumed" INTEGER NOT NULL DEFAULT 1,
    "restoredAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "appointmentLineId" INTEGER,

    CONSTRAINT "AppointmentPackageConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDeviceToken" (
    "id" SERIAL NOT NULL,
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

    CONSTRAINT "PushDeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPhoneVerification" (
    "id" TEXT NOT NULL,
    "salonId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "purpose" "CustomerPhoneVerificationPurpose" NOT NULL,
    "deliveryChannel" "ChannelType" NOT NULL DEFAULT 'WHATSAPP',
    "countryIso" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "CustomerPhoneVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "codeHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(6) NOT NULL,
    "lastSentAt" TIMESTAMP(6),
    "lastAttemptAt" TIMESTAMP(6),
    "verifiedAt" TIMESTAMP(6),
    "consumedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPhoneVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "source" "WaitlistEntrySource" NOT NULL,
    "status" "WaitlistEntryStatus" NOT NULL DEFAULT 'PENDING',
    "requestDate" DATE NOT NULL,
    "windowStartMinute" INTEGER NOT NULL,
    "windowEndMinute" INTEGER NOT NULL,
    "groups" JSONB NOT NULL,
    "preferredStaffIds" JSONB,
    "latestOfferId" INTEGER,
    "latestMatchedAt" TIMESTAMP(6),
    "closedAt" TIMESTAMP(6),
    "notes" TEXT,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "allowNearbyMatches" BOOLEAN NOT NULL DEFAULT false,
    "nearbyToleranceMinutes" INTEGER NOT NULL DEFAULT 60,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistOffer" (
    "id" SERIAL NOT NULL,
    "waitlistEntryId" INTEGER NOT NULL,
    "salonId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "channel" "WaitlistOfferChannel" NOT NULL,
    "status" "WaitlistOfferStatus" NOT NULL DEFAULT 'PENDING',
    "slotDate" DATE NOT NULL,
    "slotStartMinute" INTEGER NOT NULL,
    "slotEndMinute" INTEGER NOT NULL,
    "slotPayload" JSONB NOT NULL,
    "offerUrl" TEXT,
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "expiresAt" TIMESTAMP(6) NOT NULL,
    "sentAt" TIMESTAMP(6),
    "acceptedAt" TIMESTAMP(6),
    "rejectedAt" TIMESTAMP(6),
    "failedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "salonId" INTEGER NOT NULL,
    "createdByUserId" INTEGER NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'UPLOADING',
    "summary" JSONB,
    "startedAt" TIMESTAMP(6),
    "completedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportSourceFile" (
    "id" SERIAL NOT NULL,
    "batchId" TEXT NOT NULL,
    "salonId" INTEGER NOT NULL,
    "sourceType" "ImportSourceType" NOT NULL,
    "status" "ImportSourceFileStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "objectKey" TEXT,
    "publicUrl" TEXT,
    "extractionError" TEXT,
    "uploadedAt" TIMESTAMP(6),
    "parsedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportSourceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" SERIAL NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceFileId" INTEGER NOT NULL,
    "salonId" INTEGER NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "sourceRowHash" TEXT NOT NULL,
    "rowStatus" "ImportRowStatus" NOT NULL DEFAULT 'EXTRACTED',
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB NOT NULL,
    "customerName" TEXT,
    "customerPhoneRaw" TEXT,
    "customerPhoneNormalized" TEXT,
    "appointmentDate" DATE,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "durationMinutes" INTEGER,
    "serviceNameRaw" TEXT,
    "staffNameRaw" TEXT,
    "priceRaw" DOUBLE PRECISION,
    "notesRaw" TEXT,
    "confidence" DOUBLE PRECISION,
    "matchedCustomerId" INTEGER,
    "matchedServiceId" INTEGER,
    "matchedStaffId" INTEGER,
    "importedAppointmentId" INTEGER,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportConflict" (
    "id" SERIAL NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowId" INTEGER,
    "salonId" INTEGER NOT NULL,
    "type" "ImportConflictType" NOT NULL,
    "status" "ImportConflictStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "resolvedByUserId" INTEGER,
    "resolvedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportMappingDecision" (
    "id" SERIAL NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowId" INTEGER,
    "salonId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "decisionType" TEXT NOT NULL,
    "decisionKey" TEXT NOT NULL,
    "decisionValue" JSONB NOT NULL,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportMappingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportCommitRun" (
    "id" SERIAL NOT NULL,
    "batchId" TEXT NOT NULL,
    "salonId" INTEGER NOT NULL,
    "triggeredByUserId" INTEGER NOT NULL,
    "status" "ImportCommitStatus" NOT NULL DEFAULT 'RUNNING',
    "summary" JSONB,
    "startedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportCommitRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportExtractionRun" (
    "id" SERIAL NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceFileId" INTEGER NOT NULL,
    "salonId" INTEGER NOT NULL,
    "mode" "ImportExtractionMode" NOT NULL DEFAULT 'PRODUCTION',
    "status" "ImportExtractionRunStatus" NOT NULL DEFAULT 'RUNNING',
    "ocrProvider" TEXT NOT NULL,
    "ocrModel" TEXT,
    "ocrRawText" TEXT,
    "activeConfigSnapshot" JSONB,
    "selectedCandidateId" INTEGER,
    "error" TEXT,
    "metricsJson" JSONB,
    "startedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportExtractionCandidate" (
    "id" SERIAL NOT NULL,
    "extractionRunId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "promptLabel" TEXT,
    "rawOutputText" TEXT,
    "parsedRowsJson" JSONB,
    "scoreTotal" DOUBLE PRECISION,
    "scoreBreakdownJson" JSONB,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "reviewedByUserId" INTEGER,
    "reviewedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportExtractionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportAiConfig" (
    "id" SERIAL NOT NULL,
    "ocrProvider" TEXT NOT NULL,
    "ocrModel" TEXT,
    "llmProvider" TEXT NOT NULL,
    "llmModel" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "promptLabel" TEXT,
    "outputContractVersion" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "notesJson" JSONB,
    "activatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportAiConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotificationPreference" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "masterEnabled" BOOLEAN NOT NULL DEFAULT true,
    "eventConfig" JSONB,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppNotification" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "eventType" "NotificationEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(6),

    CONSTRAINT "AppNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppNotificationDelivery" (
    "id" SERIAL NOT NULL,
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

    CONSTRAINT "AppNotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoverAlertState" (
    "id" SERIAL NOT NULL,
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

    CONSTRAINT "HandoverAlertState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionDefinition" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonRolePermission" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "permissionId" INTEGER NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalonRolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermissionOverride" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(6),
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessAuditLog" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "actorUserId" INTEGER,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" SERIAL NOT NULL,
    "appointmentId" INTEGER,
    "customerId" INTEGER,
    "type" TEXT NOT NULL,
    "sentAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "idx_salon_closure_salon_range" ON "SalonClosure"("salonId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "idx_staff_timeoff_salon_staff_range" ON "StaffTimeOff"("salonId", "staffId", "startAt", "endAt");

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
CREATE INDEX "idx_appointment_salon_reschedule_batch" ON "Appointment"("salonId", "rescheduleBatchId");

-- CreateIndex
CREATE INDEX "idx_appointment_rescheduled_from" ON "Appointment"("rescheduledFromAppointmentId");

-- CreateIndex
CREATE INDEX "idx_appointment_line_appointment_order" ON "AppointmentLine"("appointmentId", "orderIndex");

-- CreateIndex
CREATE INDEX "idx_appointment_line_salon_status" ON "AppointmentLine"("salonId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MagicLink_token_key" ON "MagicLink"("token");

-- CreateIndex
CREATE INDEX "idx_magiclink_lookup" ON "MagicLink"("salonId", "channel", "subjectNormalized", "status");

-- CreateIndex
CREATE INDEX "idx_magiclink_session_created" ON "MagicLink"("identitySessionId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_magiclink_salon_status_exp" ON "MagicLink"("salonId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "idx_identity_session_conv" ON "IdentitySession"("salonId", "conversationKey");

-- CreateIndex
CREATE INDEX "idx_identity_session_canonical" ON "IdentitySession"("canonicalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_identity_session_subject" ON "IdentitySession"("salonId", "channel", "subjectNormalized");

-- CreateIndex
CREATE INDEX "idx_identity_binding_customer_salon" ON "IdentityBinding"("customerId", "salonId");

-- CreateIndex
CREATE INDEX "idx_identity_binding_salon_channel_active" ON "IdentityBinding"("salonId", "channel", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "uq_identity_binding_subject" ON "IdentityBinding"("salonId", "channel", "subjectNormalized");

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
CREATE INDEX "idx_gallery_category" ON "SalonGalleryImage"("categoryId");

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
CREATE INDEX "idx_campaign_salon_priority_active" ON "Campaign"("salonId", "priority", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "uq_campaign_send_execution_key" ON "CampaignSendExecution"("executionKey");

-- CreateIndex
CREATE INDEX "idx_campaign_send_exec_salon_campaign_created" ON "CampaignSendExecution"("salonId", "campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_campaign_app_salon_appointment" ON "AppointmentCampaignApplication"("salonId", "appointmentId");

-- CreateIndex
CREATE INDEX "idx_campaign_app_salon_customer_campaign" ON "AppointmentCampaignApplication"("salonId", "customerId", "campaignId");

-- CreateIndex
CREATE INDEX "idx_campaign_app_campaign_status" ON "AppointmentCampaignApplication"("campaignId", "status");

-- CreateIndex
CREATE INDEX "idx_campaign_wallet_salon_customer" ON "CustomerCampaignWallet"("salonId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_campaign_wallet_salon_customer_campaign" ON "CustomerCampaignWallet"("salonId", "customerId", "campaignId");

-- CreateIndex
CREATE INDEX "idx_campaign_enrollment_salon_status" ON "CustomerCampaignEnrollment"("salonId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_campaign_enrollment_salon_customer_campaign" ON "CustomerCampaignEnrollment"("salonId", "customerId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_campaign_share_link_token" ON "CampaignShareLink"("token");

-- CreateIndex
CREATE INDEX "idx_campaign_share_link_salon_status" ON "CampaignShareLink"("salonId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_campaign_share_link_salon_campaign_customer" ON "CampaignShareLink"("salonId", "campaignId", "customerId");

-- CreateIndex
CREATE INDEX "idx_campaign_attr_salon_campaign_status" ON "CampaignAttribution"("salonId", "campaignId", "status");

-- CreateIndex
CREATE INDEX "idx_campaign_attr_share_link" ON "CampaignAttribution"("shareLinkId");

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
CREATE INDEX "idx_blacklist_identity_active" ON "BlacklistEntry"("salonId", "channel", "subjectNormalized", "isActive");

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
CREATE INDEX "idx_message_event_salon_conv_ts" ON "ConversationMessageEvent"("salonId", "channel", "conversationKey", "eventTimestamp");

-- CreateIndex
CREATE INDEX "idx_message_event_salon_channel_ts" ON "ConversationMessageEvent"("salonId", "channel", "eventTimestamp");

-- CreateIndex
CREATE INDEX "idx_message_event_salon_conv_status" ON "ConversationMessageEvent"("salonId", "channel", "conversationKey", "processingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "uq_message_event_channel_provider" ON "ConversationMessageEvent"("channel", "providerMessageId");

-- CreateIndex
CREATE INDEX "idx_conv_thread_summary_salon_channel_last_ts" ON "ConversationThreadSummary"("salonId", "channel", "lastEventTimestamp");

-- CreateIndex
CREATE INDEX "idx_conv_thread_summary_salon_last_ts" ON "ConversationThreadSummary"("salonId", "lastEventTimestamp");

-- CreateIndex
CREATE UNIQUE INDEX "uq_conv_thread_summary_salon_channel_key" ON "ConversationThreadSummary"("salonId", "channel", "conversationKey");

-- CreateIndex
CREATE INDEX "idx_conv_realtime_salon_cursor" ON "ConversationRealtimeEvent"("salonId", "id");

-- CreateIndex
CREATE INDEX "idx_conv_realtime_salon_channel_cursor" ON "ConversationRealtimeEvent"("salonId", "channel", "id");

-- CreateIndex
CREATE INDEX "idx_conv_realtime_salon_conv_cursor" ON "ConversationRealtimeEvent"("salonId", "channel", "conversationKey", "id");

-- CreateIndex
CREATE INDEX "idx_conv_realtime_message_event_id" ON "ConversationRealtimeEvent"("messageEventId");

-- CreateIndex
CREATE INDEX "MetaChannelWebhookLog_channel_direction_createdAt_idx" ON "MetaChannelWebhookLog"("channel", "direction", "createdAt");

-- CreateIndex
CREATE INDEX "MetaChannelWebhookLog_conversationKey_idx" ON "MetaChannelWebhookLog"("conversationKey");

-- CreateIndex
CREATE INDEX "MetaChannelWebhookLog_salonId_createdAt_idx" ON "MetaChannelWebhookLog"("salonId", "createdAt");

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

-- CreateIndex
CREATE INDEX "idx_channel_profile_cache_salon_channel_updated" ON "ChannelProfileCache"("salonId", "channel", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_channel_profile_cache_subject" ON "ChannelProfileCache"("salonId", "channel", "subjectNormalized");

-- CreateIndex
CREATE INDEX "idx_pkg_template_salon_active" ON "PackageTemplate"("salonId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "uq_pkg_template_salon_name" ON "PackageTemplate"("salonId", "name");

-- CreateIndex
CREATE INDEX "idx_pkg_template_service_service" ON "PackageTemplateService"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_pkg_template_service" ON "PackageTemplateService"("packageTemplateId", "serviceId");

-- CreateIndex
CREATE INDEX "idx_customer_pkg_salon_customer_status" ON "CustomerPackage"("salonId", "customerId", "status");

-- CreateIndex
CREATE INDEX "idx_customer_pkg_salon_expires" ON "CustomerPackage"("salonId", "expiresAt");

-- CreateIndex
CREATE INDEX "idx_customer_pkg_balance_service" ON "CustomerPackageServiceBalance"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_customer_pkg_balance" ON "CustomerPackageServiceBalance"("customerPackageId", "serviceId");

-- CreateIndex
CREATE INDEX "idx_pkg_ledger_salon_customer_created" ON "PackageLedger"("salonId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_pkg_ledger_customer_pkg_created" ON "PackageLedger"("customerPackageId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_pkg_ledger_appointment" ON "PackageLedger"("appointmentId");

-- CreateIndex
CREATE INDEX "idx_pkg_ledger_appointment_line" ON "PackageLedger"("appointmentLineId");

-- CreateIndex
CREATE INDEX "idx_appointment_pkg_consumption_salon_customer" ON "AppointmentPackageConsumption"("salonId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_appointment_pkg_consumption_line" ON "AppointmentPackageConsumption"("appointmentId", "appointmentLineId", "serviceId");

-- CreateIndex
CREATE INDEX "idx_push_device_salon_user_active" ON "PushDeviceToken"("salonId", "userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "uq_push_device_platform_token" ON "PushDeviceToken"("platform", "token");

-- CreateIndex
CREATE INDEX "idx_customer_phone_verification_phone_status" ON "CustomerPhoneVerification"("salonId", "phone", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "idx_customer_phone_verification_customer_salon" ON "CustomerPhoneVerification"("customerId", "salonId");

-- CreateIndex
CREATE INDEX "idx_waitlist_entry_day_status_created" ON "WaitlistEntry"("salonId", "requestDate", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_waitlist_entry_customer_salon" ON "WaitlistEntry"("customerId", "salonId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_waitlist_offer_token" ON "WaitlistOffer"("token");

-- CreateIndex
CREATE INDEX "idx_waitlist_offer_day_status_exp" ON "WaitlistOffer"("salonId", "slotDate", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "idx_waitlist_offer_entry_created" ON "WaitlistOffer"("waitlistEntryId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_import_batch_salon_status_created" ON "ImportBatch"("salonId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_import_source_file_batch_status" ON "ImportSourceFile"("batchId", "status");

-- CreateIndex
CREATE INDEX "idx_import_row_batch_status" ON "ImportRow"("batchId", "rowStatus");

-- CreateIndex
CREATE UNIQUE INDEX "uq_import_row_batch_hash" ON "ImportRow"("batchId", "sourceRowHash");

-- CreateIndex
CREATE INDEX "idx_import_conflict_batch_status_type" ON "ImportConflict"("batchId", "status", "type");

-- CreateIndex
CREATE INDEX "idx_import_decision_batch_row_created" ON "ImportMappingDecision"("batchId", "rowId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_import_commit_batch_status_created" ON "ImportCommitRun"("batchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_import_extraction_run_file_created" ON "ImportExtractionRun"("batchId", "sourceFileId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_import_extraction_run_status_mode_created" ON "ImportExtractionRun"("status", "mode", "createdAt");

-- CreateIndex
CREATE INDEX "idx_import_extraction_candidate_run_selected_score" ON "ImportExtractionCandidate"("extractionRunId", "isSelected", "scoreTotal");

-- CreateIndex
CREATE INDEX "idx_import_ai_config_active_updated" ON "ImportAiConfig"("isActive", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_notification_pref_salon_user" ON "UserNotificationPreference"("salonId", "userId");

-- CreateIndex
CREATE INDEX "idx_app_notification_salon_created" ON "AppNotification"("salonId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_notification_delivery_notification" ON "AppNotificationDelivery"("notificationId");

-- CreateIndex
CREATE INDEX "idx_notification_delivery_user_read" ON "AppNotificationDelivery"("salonId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "idx_handover_alert_state_updated" ON "HandoverAlertState"("state", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_handover_alert_salon_channel_key" ON "HandoverAlertState"("salonId", "channel", "conversationKey");

-- CreateIndex
CREATE UNIQUE INDEX "uq_permission_definition_key" ON "PermissionDefinition"("key");

-- CreateIndex
CREATE INDEX "idx_salon_role_permission_salon_role" ON "SalonRolePermission"("salonId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "uq_salon_role_permission" ON "SalonRolePermission"("salonId", "role", "permissionId");

-- CreateIndex
CREATE INDEX "idx_user_permission_override_salon_user" ON "UserPermissionOverride"("salonId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_permission_override" ON "UserPermissionOverride"("salonId", "userId", "permissionId");

-- CreateIndex
CREATE INDEX "idx_access_audit_salon_created" ON "AccessAuditLog"("salonId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_appointmentId_type_idx" ON "NotificationLog"("appointmentId", "type");

-- CreateIndex
CREATE INDEX "NotificationLog_customerId_type_idx" ON "NotificationLog"("customerId", "type");

-- AddForeignKey
ALTER TABLE "SalonSettings" ADD CONSTRAINT "SalonSettings_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonAiAgentSettings" ADD CONSTRAINT "SalonAiAgentSettings_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonUser" ADD CONSTRAINT "SalonUser_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MobileAuthSession" ADD CONSTRAINT "MobileAuthSession_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MobileAuthSession" ADD CONSTRAINT "MobileAuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SalonUser"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Leave" ADD CONSTRAINT "Leave_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonClosure" ADD CONSTRAINT "SalonClosure_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StaffTimeOff" ADD CONSTRAINT "StaffTimeOff_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StaffTimeOff" ADD CONSTRAINT "StaffTimeOff_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "ServiceRegion"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_serviceGroupId_fkey" FOREIGN KEY ("serviceGroupId") REFERENCES "ServiceGroup"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

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
ALTER TABLE "AppointmentLine" ADD CONSTRAINT "AppointmentLine_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentLine" ADD CONSTRAINT "AppointmentLine_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentLine" ADD CONSTRAINT "AppointmentLine_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentLine" ADD CONSTRAINT "AppointmentLine_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentLine" ADD CONSTRAINT "AppointmentLine_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MagicLink" ADD CONSTRAINT "MagicLink_identitySessionId_fkey" FOREIGN KEY ("identitySessionId") REFERENCES "IdentitySession"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MagicLink" ADD CONSTRAINT "MagicLink_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MagicLink" ADD CONSTRAINT "MagicLink_usedByCustomerId_fkey" FOREIGN KEY ("usedByCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "IdentitySession" ADD CONSTRAINT "IdentitySession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "IdentitySession" ADD CONSTRAINT "IdentitySession_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "IdentityBinding" ADD CONSTRAINT "IdentityBinding_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "IdentityBinding" ADD CONSTRAINT "IdentityBinding_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "IdentityBinding" ADD CONSTRAINT "IdentityBinding_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "IdentitySession"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

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
ALTER TABLE "ServiceRegion" ADD CONSTRAINT "ServiceRegion_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ServiceRegion" ADD CONSTRAINT "ServiceRegion_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonGalleryImage" ADD CONSTRAINT "SalonGalleryImage_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonGalleryImage" ADD CONSTRAINT "SalonGalleryImage_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonTestimonial" ADD CONSTRAINT "SalonTestimonial_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonTestimonial" ADD CONSTRAINT "SalonTestimonial_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonTestimonial" ADD CONSTRAINT "SalonTestimonial_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CampaignSendExecution" ADD CONSTRAINT "CampaignSendExecution_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CampaignSendExecution" ADD CONSTRAINT "CampaignSendExecution_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentCampaignApplication" ADD CONSTRAINT "AppointmentCampaignApplication_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentCampaignApplication" ADD CONSTRAINT "AppointmentCampaignApplication_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentCampaignApplication" ADD CONSTRAINT "AppointmentCampaignApplication_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentCampaignApplication" ADD CONSTRAINT "AppointmentCampaignApplication_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentCampaignApplication" ADD CONSTRAINT "AppointmentCampaignApplication_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomerCampaignWallet" ADD CONSTRAINT "CustomerCampaignWallet_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomerCampaignWallet" ADD CONSTRAINT "CustomerCampaignWallet_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomerCampaignWallet" ADD CONSTRAINT "CustomerCampaignWallet_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomerCampaignEnrollment" ADD CONSTRAINT "CustomerCampaignEnrollment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomerCampaignEnrollment" ADD CONSTRAINT "CustomerCampaignEnrollment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomerCampaignEnrollment" ADD CONSTRAINT "CustomerCampaignEnrollment_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CampaignShareLink" ADD CONSTRAINT "CampaignShareLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CampaignShareLink" ADD CONSTRAINT "CampaignShareLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CampaignShareLink" ADD CONSTRAINT "CampaignShareLink_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CampaignAttribution" ADD CONSTRAINT "CampaignAttribution_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CampaignAttribution" ADD CONSTRAINT "CampaignAttribution_firstAppointmentId_fkey" FOREIGN KEY ("firstAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CampaignAttribution" ADD CONSTRAINT "CampaignAttribution_referredCustomerId_fkey" FOREIGN KEY ("referredCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CampaignAttribution" ADD CONSTRAINT "CampaignAttribution_referrerCustomerId_fkey" FOREIGN KEY ("referrerCustomerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CampaignAttribution" ADD CONSTRAINT "CampaignAttribution_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CampaignAttribution" ADD CONSTRAINT "CampaignAttribution_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "CampaignShareLink"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentMessageDispatch" ADD CONSTRAINT "AppointmentMessageDispatch_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentMessageDispatch" ADD CONSTRAINT "AppointmentMessageDispatch_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

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
ALTER TABLE "ConversationMessageEvent" ADD CONSTRAINT "ConversationMessageEvent_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ConversationThreadSummary" ADD CONSTRAINT "ConversationThreadSummary_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ConversationRealtimeEvent" ADD CONSTRAINT "ConversationRealtimeEvent_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ConversationState" ADD CONSTRAINT "ConversationState_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OutboundMessageTrace" ADD CONSTRAINT "OutboundMessageTrace_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChannelProfileCache" ADD CONSTRAINT "ChannelProfileCache_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ServiceGender" ADD CONSTRAINT "ServiceGender_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StaffServiceCustomSlot" ADD CONSTRAINT "fk_staffservice" FOREIGN KEY ("staffServiceId") REFERENCES "StaffService"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PackageTemplate" ADD CONSTRAINT "PackageTemplate_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PackageTemplateService" ADD CONSTRAINT "PackageTemplateService_packageTemplateId_fkey" FOREIGN KEY ("packageTemplateId") REFERENCES "PackageTemplate"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PackageTemplateService" ADD CONSTRAINT "PackageTemplateService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomerPackage" ADD CONSTRAINT "CustomerPackage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomerPackage" ADD CONSTRAINT "CustomerPackage_packageTemplateId_fkey" FOREIGN KEY ("packageTemplateId") REFERENCES "PackageTemplate"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomerPackage" ADD CONSTRAINT "CustomerPackage_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomerPackageServiceBalance" ADD CONSTRAINT "CustomerPackageServiceBalance_customerPackageId_fkey" FOREIGN KEY ("customerPackageId") REFERENCES "CustomerPackage"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomerPackageServiceBalance" ADD CONSTRAINT "CustomerPackageServiceBalance_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PackageLedger" ADD CONSTRAINT "PackageLedger_appointmentLineId_fkey" FOREIGN KEY ("appointmentLineId") REFERENCES "AppointmentLine"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PackageLedger" ADD CONSTRAINT "PackageLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PackageLedger" ADD CONSTRAINT "PackageLedger_customerPackageId_fkey" FOREIGN KEY ("customerPackageId") REFERENCES "CustomerPackage"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PackageLedger" ADD CONSTRAINT "PackageLedger_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PackageLedger" ADD CONSTRAINT "PackageLedger_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentPackageConsumption" ADD CONSTRAINT "AppointmentPackageConsumption_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentPackageConsumption" ADD CONSTRAINT "AppointmentPackageConsumption_appointmentLineId_fkey" FOREIGN KEY ("appointmentLineId") REFERENCES "AppointmentLine"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentPackageConsumption" ADD CONSTRAINT "AppointmentPackageConsumption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentPackageConsumption" ADD CONSTRAINT "AppointmentPackageConsumption_customerPackageId_fkey" FOREIGN KEY ("customerPackageId") REFERENCES "CustomerPackage"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentPackageConsumption" ADD CONSTRAINT "AppointmentPackageConsumption_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AppointmentPackageConsumption" ADD CONSTRAINT "AppointmentPackageConsumption_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomerPhoneVerification" ADD CONSTRAINT "CustomerPhoneVerification_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomerPhoneVerification" ADD CONSTRAINT "CustomerPhoneVerification_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WaitlistOffer" ADD CONSTRAINT "WaitlistOffer_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WaitlistOffer" ADD CONSTRAINT "WaitlistOffer_waitlistEntryId_fkey" FOREIGN KEY ("waitlistEntryId") REFERENCES "WaitlistEntry"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "SalonUser"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportSourceFile" ADD CONSTRAINT "ImportSourceFile_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportSourceFile" ADD CONSTRAINT "ImportSourceFile_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportSourceFile"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportConflict" ADD CONSTRAINT "ImportConflict_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportConflict" ADD CONSTRAINT "ImportConflict_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "SalonUser"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportConflict" ADD CONSTRAINT "ImportConflict_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "ImportRow"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportConflict" ADD CONSTRAINT "ImportConflict_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportMappingDecision" ADD CONSTRAINT "ImportMappingDecision_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportMappingDecision" ADD CONSTRAINT "ImportMappingDecision_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "ImportRow"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportMappingDecision" ADD CONSTRAINT "ImportMappingDecision_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportMappingDecision" ADD CONSTRAINT "ImportMappingDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SalonUser"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportCommitRun" ADD CONSTRAINT "ImportCommitRun_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportCommitRun" ADD CONSTRAINT "ImportCommitRun_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportCommitRun" ADD CONSTRAINT "ImportCommitRun_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "SalonUser"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportExtractionRun" ADD CONSTRAINT "ImportExtractionRun_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportExtractionRun" ADD CONSTRAINT "ImportExtractionRun_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportExtractionRun" ADD CONSTRAINT "ImportExtractionRun_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportSourceFile"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportExtractionCandidate" ADD CONSTRAINT "ImportExtractionCandidate_extractionRunId_fkey" FOREIGN KEY ("extractionRunId") REFERENCES "ImportExtractionRun"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportExtractionCandidate" ADD CONSTRAINT "ImportExtractionCandidate_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "SalonUser"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImportAiConfig" ADD CONSTRAINT "ImportAiConfig_activatedByUserId_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "SalonUser"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

