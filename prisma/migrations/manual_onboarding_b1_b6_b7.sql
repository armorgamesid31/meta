-- Manual idempotent migration for B1 + B6 + B7
-- Safe to re-run; uses IF NOT EXISTS / DO blocks

-- ====== Enums ======
DO $$ BEGIN
  CREATE TYPE "SalonCategory" AS ENUM ('KUAFOR_KADIN', 'KUAFOR_ERKEK', 'KUAFOR_UNISEX', 'GUZELLIK_MERKEZI', 'TIRNAK_STUDYOSU', 'ESTETIK_KLINIK', 'SPA_WELLNESS', 'BARBER', 'DIGER');
EXCEPTION WHEN duplicate_object THEN
  -- if exists but BARBER missing, add it
  BEGIN
    ALTER TYPE "SalonCategory" ADD VALUE IF NOT EXISTS 'BARBER';
  EXCEPTION WHEN others THEN NULL; END;
END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OnboardingStep" AS ENUM ('NOT_STARTED', 'WELCOME', 'SALON_NAME', 'SLUG', 'ADDRESS', 'PHONE', 'WORKING_HOURS', 'LOGO', 'GALLERY', 'SERVICES', 'TONE', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ====== Salon columns ======
ALTER TABLE "Salon"
  ADD COLUMN IF NOT EXISTS "category" "SalonCategory",
  ADD COLUMN IF NOT EXISTS "kurulumScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "kurulumStage" TEXT,
  ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "onboardingSkipped" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS "onboardingStep" "OnboardingStep" NOT NULL DEFAULT 'NOT_STARTED';

-- ====== salon_journey_tasks ======
CREATE TABLE IF NOT EXISTS "salon_journey_tasks" (
  "id" SERIAL NOT NULL,
  "salonId" INTEGER NOT NULL,
  "taskKey" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "points" INTEGER NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "salon_journey_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "salon_journey_tasks_salonId_completedAt_idx" ON "salon_journey_tasks"("salonId", "completedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "salon_journey_tasks_salonId_taskKey_key" ON "salon_journey_tasks"("salonId", "taskKey");

DO $$ BEGIN
  ALTER TABLE "salon_journey_tasks"
    ADD CONSTRAINT "salon_journey_tasks_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ====== service_templates ======
CREATE TABLE IF NOT EXISTS "service_templates" (
  "id" SERIAL NOT NULL,
  "category" "SalonCategory" NOT NULL,
  "name" TEXT NOT NULL,
  "defaultDurationMin" INTEGER NOT NULL DEFAULT 30,
  "defaultPriceTRY" INTEGER,
  "serviceCategoryId" INTEGER,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "service_templates_category_isActive_displayOrder_idx" ON "service_templates"("category", "isActive", "displayOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "service_templates_category_name_key" ON "service_templates"("category", "name");

DO $$ BEGIN
  ALTER TABLE "service_templates"
    ADD CONSTRAINT "service_templates_serviceCategoryId_fkey"
    FOREIGN KEY ("serviceCategoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
