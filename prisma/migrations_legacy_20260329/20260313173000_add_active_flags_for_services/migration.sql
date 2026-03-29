ALTER TABLE "Service" ADD COLUMN "isActive" BOOLEAN DEFAULT true;
ALTER TABLE "ServiceCategory" ADD COLUMN "isActive" BOOLEAN DEFAULT true;
ALTER TABLE "ServiceGroup" ADD COLUMN "isActive" BOOLEAN DEFAULT true;

UPDATE "Service" SET "isActive" = true WHERE "isActive" IS NULL;
UPDATE "ServiceCategory" SET "isActive" = true WHERE "isActive" IS NULL;
UPDATE "ServiceGroup" SET "isActive" = true WHERE "isActive" IS NULL;
