ALTER TABLE "Staff"
  ADD COLUMN IF NOT EXISTS "profileImageUrl" TEXT;

ALTER TABLE "ServiceCategory"
  ADD COLUMN IF NOT EXISTS "coverImageUrl" TEXT;
