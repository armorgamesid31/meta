-- AlterTable
-- Gün-bazlı çalışma saati override'ı (SalonSettings.workingHoursByDay).
-- IF NOT EXISTS: kolon prod'a manuel ALTER ile zaten eklenmiş olabilir (idempotent).
ALTER TABLE "SalonSettings" ADD COLUMN IF NOT EXISTS "workingHoursByDay" JSONB;
