-- Create import wizard enums
CREATE TYPE "ImportBatchStatus" AS ENUM (
  'UPLOADING',
  'PARSING',
  'NEEDS_REVIEW',
  'READY_TO_COMMIT',
  'COMMITTING',
  'COMPLETED',
  'FAILED'
);

CREATE TYPE "ImportSourceType" AS ENUM ('CSV', 'EXCEL', 'PDF', 'IMAGE');

CREATE TYPE "ImportSourceFileStatus" AS ENUM (
  'PENDING_UPLOAD',
  'PARSING',
  'WAITING_OCR',
  'PARSED',
  'FAILED_EXTRACTION'
);

CREATE TYPE "ImportRowStatus" AS ENUM (
  'EXTRACTED',
  'READY',
  'CONFLICT',
  'SKIPPED',
  'IMPORTED',
  'FAILED'
);

CREATE TYPE "ImportConflictType" AS ENUM (
  'MISSING_PHONE',
  'INVALID_PHONE',
  'SERVICE_UNMATCHED',
  'STAFF_UNMATCHED',
  'APPOINTMENT_OVERLAP',
  'OUT_OF_RANGE_DATE',
  'VALIDATION_ERROR'
);

CREATE TYPE "ImportConflictStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

CREATE TYPE "ImportCommitStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED');

-- Create import wizard tables
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

-- Create indexes and uniques
CREATE INDEX "idx_import_batch_salon_status_created" ON "ImportBatch" ("salonId", "status", "createdAt");
CREATE INDEX "idx_import_source_file_batch_status" ON "ImportSourceFile" ("batchId", "status");
CREATE UNIQUE INDEX "uq_import_row_batch_hash" ON "ImportRow" ("batchId", "sourceRowHash");
CREATE INDEX "idx_import_row_batch_status" ON "ImportRow" ("batchId", "rowStatus");
CREATE INDEX "idx_import_conflict_batch_status_type" ON "ImportConflict" ("batchId", "status", "type");
CREATE INDEX "idx_import_decision_batch_row_created" ON "ImportMappingDecision" ("batchId", "rowId", "createdAt");
CREATE INDEX "idx_import_commit_batch_status_created" ON "ImportCommitRun" ("batchId", "status", "createdAt");

-- Add foreign keys
ALTER TABLE "ImportBatch"
  ADD CONSTRAINT "ImportBatch_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportBatch"
  ADD CONSTRAINT "ImportBatch_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "SalonUser"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ImportSourceFile"
  ADD CONSTRAINT "ImportSourceFile_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportSourceFile"
  ADD CONSTRAINT "ImportSourceFile_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportRow"
  ADD CONSTRAINT "ImportRow_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportRow"
  ADD CONSTRAINT "ImportRow_sourceFileId_fkey"
  FOREIGN KEY ("sourceFileId") REFERENCES "ImportSourceFile"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportRow"
  ADD CONSTRAINT "ImportRow_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportConflict"
  ADD CONSTRAINT "ImportConflict_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportConflict"
  ADD CONSTRAINT "ImportConflict_rowId_fkey"
  FOREIGN KEY ("rowId") REFERENCES "ImportRow"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportConflict"
  ADD CONSTRAINT "ImportConflict_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportConflict"
  ADD CONSTRAINT "ImportConflict_resolvedByUserId_fkey"
  FOREIGN KEY ("resolvedByUserId") REFERENCES "SalonUser"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "ImportMappingDecision"
  ADD CONSTRAINT "ImportMappingDecision_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportMappingDecision"
  ADD CONSTRAINT "ImportMappingDecision_rowId_fkey"
  FOREIGN KEY ("rowId") REFERENCES "ImportRow"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "ImportMappingDecision"
  ADD CONSTRAINT "ImportMappingDecision_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportMappingDecision"
  ADD CONSTRAINT "ImportMappingDecision_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "SalonUser"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ImportCommitRun"
  ADD CONSTRAINT "ImportCommitRun_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportCommitRun"
  ADD CONSTRAINT "ImportCommitRun_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportCommitRun"
  ADD CONSTRAINT "ImportCommitRun_triggeredByUserId_fkey"
  FOREIGN KEY ("triggeredByUserId") REFERENCES "SalonUser"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
