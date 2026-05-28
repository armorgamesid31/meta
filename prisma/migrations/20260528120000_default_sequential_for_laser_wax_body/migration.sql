-- Backfill: turn on sequentialRequired for the LASER, WAX and BODY
-- categories in existing salons, matching the new-salon default in
-- services/salonCategorySetup.ts:DEFAULT_SEQUENTIAL_KEYS.
--
-- Why these three:
--   * LASER (Lazer Epilasyon) — client undresses for bikini / leg
--     / underarm passes.
--   * WAX (Ağda) — same undress / prep pattern.
--   * BODY (Vücut Şekillendirme ve Masaj) — full-body massage,
--     pressotherapy, lipo, anti-cellulite: undress + oil/gel + lie
--     down. Wedging an unrelated service between two chained slots
--     here breaks the operational flow.
--
-- We only flip rows that are NOT already TRUE. Salons that have
-- deliberately enabled it stay enabled (no-op for them); salons
-- that have explicitly toggled it OFF after this migration runs
-- keep their choice — we only fix the legacy default of FALSE/NULL
-- that pre-dated the per-category default.

UPDATE "ServiceCategory" sc
SET "sequentialRequired" = TRUE,
    "updatedAt" = NOW()
FROM "Category" c
WHERE sc."categoryId" = c.id
  AND c."key" IN ('LASER', 'WAX', 'BODY')
  AND COALESCE(sc."sequentialRequired", FALSE) = FALSE;
