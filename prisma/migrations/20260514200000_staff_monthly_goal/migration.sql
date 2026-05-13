-- Add monthlyGoal field to Staff for specialist dashboard progress tracking.
-- Default 0 means "no goal set yet" — owner can update it later via staff edit form.
ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "monthlyGoal" INTEGER NOT NULL DEFAULT 0;
