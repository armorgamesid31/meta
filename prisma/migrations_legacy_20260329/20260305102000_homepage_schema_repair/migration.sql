-- Repair migration for environments where baseline was marked applied but schema objects are missing.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BookingMode') THEN
    CREATE TYPE "BookingMode" AS ENUM ('INTERNAL', 'WHATSAPP');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TestimonialTemplateType') THEN
    CREATE TYPE "TestimonialTemplateType" AS ENUM ('CATEGORY_EXPERT', 'EXPERT_ONLY', 'CATEGORY_ONLY', 'GENERIC');
  END IF;
END$$;

ALTER TABLE "Salon"
  ADD COLUMN IF NOT EXISTS "tagline" TEXT,
  ADD COLUMN IF NOT EXISTS "about" TEXT,
  ADD COLUMN IF NOT EXISTS "heroImageUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "instagramUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "bookingMode" "BookingMode" DEFAULT 'INTERNAL';

ALTER TABLE "Staff"
  ADD COLUMN IF NOT EXISTS "title" TEXT,
  ADD COLUMN IF NOT EXISTS "bio" TEXT;

ALTER TABLE "ServiceCategory"
  ADD COLUMN IF NOT EXISTS "marketingDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "icon" TEXT,
  ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER;

CREATE TABLE IF NOT EXISTS "SalonGalleryImage" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "altText" TEXT,
  "displayOrder" INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "SalonTestimonial" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "expertId" INTEGER,
  "categoryId" INTEGER,
  "templateType" "TestimonialTemplateType",
  "generatedText" TEXT NOT NULL,
  "isGenerated" BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_servicecategory_salon_display_order" ON "ServiceCategory"("salonId", "displayOrder");
CREATE INDEX IF NOT EXISTS "idx_gallery_salon_display_order" ON "SalonGalleryImage"("salonId", "displayOrder");
CREATE INDEX IF NOT EXISTS "idx_testimonial_salon" ON "SalonTestimonial"("salonId");
CREATE INDEX IF NOT EXISTS "idx_testimonial_expert" ON "SalonTestimonial"("expertId");
CREATE INDEX IF NOT EXISTS "idx_testimonial_category" ON "SalonTestimonial"("categoryId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalonGalleryImage_salonId_fkey') THEN
    ALTER TABLE "SalonGalleryImage"
      ADD CONSTRAINT "SalonGalleryImage_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalonTestimonial_salonId_fkey') THEN
    ALTER TABLE "SalonTestimonial"
      ADD CONSTRAINT "SalonTestimonial_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalonTestimonial_expertId_fkey') THEN
    ALTER TABLE "SalonTestimonial"
      ADD CONSTRAINT "SalonTestimonial_expertId_fkey"
      FOREIGN KEY ("expertId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalonTestimonial_categoryId_fkey') THEN
    ALTER TABLE "SalonTestimonial"
      ADD CONSTRAINT "SalonTestimonial_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END$$;
