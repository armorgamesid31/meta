-- Same-day appointment notification split:
-- "Yeni randevu" (SAME_DAY_APPOINTMENT_NEW) artık iptal/değişiklikten
-- (SAME_DAY_APPOINTMENT_CHANGE) ayrı bir bildirim tipi. Eski CHANGE tipi,
-- UPDATED/CANCELLED için korunur; CREATED yeni tipe taşınır (kod tarafı).
-- Loose-script deseni (repo'daki diğer enum eklemeleri gibi): manuel
-- `prisma db execute` ile uygulanır, prisma migrate deploy bunu görmez.

DO $$ BEGIN
  ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'SAME_DAY_APPOINTMENT_NEW';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
