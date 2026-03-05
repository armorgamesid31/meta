-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('INTERNAL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "TestimonialTemplateType" AS ENUM ('CATEGORY_EXPERT', 'EXPERT_ONLY', 'CATEGORY_ONLY', 'GENERIC');

-- AlterTable
ALTER TABLE "Salon"
ADD COLUMN "tagline" TEXT,
ADD COLUMN "about" TEXT,
ADD COLUMN "heroImageUrl" TEXT,
ADD COLUMN "instagramUrl" TEXT,
ADD COLUMN "whatsappPhone" TEXT,
ADD COLUMN "bookingMode" "BookingMode" DEFAULT 'INTERNAL';

-- AlterTable
ALTER TABLE "Staff"
ADD COLUMN "title" TEXT,
ADD COLUMN "bio" TEXT;

-- AlterTable
ALTER TABLE "ServiceCategory"
ADD COLUMN "marketingDescription" TEXT,
ADD COLUMN "icon" TEXT,
ADD COLUMN "displayOrder" INTEGER;

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

-- CreateIndex
CREATE INDEX "idx_servicecategory_salon_display_order" ON "ServiceCategory"("salonId", "displayOrder");

-- CreateIndex
CREATE INDEX "idx_gallery_salon_display_order" ON "SalonGalleryImage"("salonId", "displayOrder");

-- CreateIndex
CREATE INDEX "idx_testimonial_salon" ON "SalonTestimonial"("salonId");

-- CreateIndex
CREATE INDEX "idx_testimonial_expert" ON "SalonTestimonial"("expertId");

-- CreateIndex
CREATE INDEX "idx_testimonial_category" ON "SalonTestimonial"("categoryId");

-- AddForeignKey
ALTER TABLE "SalonGalleryImage" ADD CONSTRAINT "SalonGalleryImage_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonTestimonial" ADD CONSTRAINT "SalonTestimonial_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonTestimonial" ADD CONSTRAINT "SalonTestimonial_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalonTestimonial" ADD CONSTRAINT "SalonTestimonial_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
