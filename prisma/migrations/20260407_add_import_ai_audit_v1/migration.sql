ALTER TYPE "AppointmentSource" ADD VALUE IF NOT EXISTS 'IMPORT';

CREATE TYPE "ImportExtractionMode" AS ENUM ('PRODUCTION', 'BENCHMARK');
CREATE TYPE "ImportExtractionRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

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

CREATE INDEX "idx_import_extraction_run_file_created" ON "ImportExtractionRun" ("batchId", "sourceFileId", "createdAt");
CREATE INDEX "idx_import_extraction_run_status_mode_created" ON "ImportExtractionRun" ("status", "mode", "createdAt");
CREATE INDEX "idx_import_extraction_candidate_run_selected_score" ON "ImportExtractionCandidate" ("extractionRunId", "isSelected", "scoreTotal");
CREATE INDEX "idx_import_ai_config_active_updated" ON "ImportAiConfig" ("isActive", "updatedAt");

ALTER TABLE "ImportExtractionRun"
  ADD CONSTRAINT "ImportExtractionRun_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportExtractionRun"
  ADD CONSTRAINT "ImportExtractionRun_sourceFileId_fkey"
  FOREIGN KEY ("sourceFileId") REFERENCES "ImportSourceFile"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportExtractionRun"
  ADD CONSTRAINT "ImportExtractionRun_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportExtractionCandidate"
  ADD CONSTRAINT "ImportExtractionCandidate_extractionRunId_fkey"
  FOREIGN KEY ("extractionRunId") REFERENCES "ImportExtractionRun"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ImportExtractionCandidate"
  ADD CONSTRAINT "ImportExtractionCandidate_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "SalonUser"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "ImportAiConfig"
  ADD CONSTRAINT "ImportAiConfig_activatedByUserId_fkey"
  FOREIGN KEY ("activatedByUserId") REFERENCES "SalonUser"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
