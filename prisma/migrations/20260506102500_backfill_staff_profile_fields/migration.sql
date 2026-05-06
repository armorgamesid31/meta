UPDATE "Staff"
SET
  "firstName" = COALESCE(NULLIF(TRIM(SPLIT_PART(COALESCE("name", ''), ' ', 1)), ''), 'Uzman'),
  "lastName" = NULLIF(TRIM(REGEXP_REPLACE(COALESCE("name", ''), '^\\S+\\s*', '')), ''),
  "gender" = COALESCE("gender", 'other'::"CustomerGender")
WHERE "firstName" IS NULL
   OR "lastName" IS NULL
   OR "gender" IS NULL;

UPDATE "Staff"
SET "name" = TRIM(CONCAT("firstName", ' ', COALESCE("lastName", '')))
WHERE "firstName" IS NOT NULL;

ALTER TABLE "Staff"
  ALTER COLUMN "firstName" SET NOT NULL,
  ALTER COLUMN "gender" SET NOT NULL;
