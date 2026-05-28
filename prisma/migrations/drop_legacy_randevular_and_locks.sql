-- Eski sistem tablolarını drop (availability-engine-rework follow-up, 2026-05-28).
--
-- Bu iki tablo eski booking mimarisinden kalmıştı:
--   * randevular     — eski (Türkçe-schema) randevu kayıtları
--   * temporary_locks — eski lock sistemi (yeni SlotLock onun yerini aldı)
--
-- Production kodu artık ikisine de dokunmuyor:
--   * PR1: bookings.ts cancel/reschedule modern Appointment'a indirgendi
--   * PR7: SlotLock yeni lock mekanizması
--   * src/*.test.ts dead test dosyaları silindi
--
-- Prisma schema'da model yok, Prisma client'tan kimse erişmiyor.
-- IF EXISTS güvenlik şemsiyesi: tablo zaten yoksa hata vermez.
-- CASCADE foreign key bağı varsa onları da temizler (modern schema'da
-- bağ yok, yine de tutarlılık için).

DROP TABLE IF EXISTS "randevular" CASCADE;
DROP TABLE IF EXISTS "temporary_locks" CASCADE;
