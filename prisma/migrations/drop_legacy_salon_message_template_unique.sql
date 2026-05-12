-- Drop the legacy unique index on (salonId, eventType, locale) — leftover
-- from the pre-tone-varied schema. With the new wave-based queue we keep
-- multiple SalonMessageTemplate rows per eventType (one per tone × slot),
-- so this constraint silently rejected 8 of every 9 enqueue attempts.
--
-- The new uniqueness on (salonId, templateName) — index
-- uq_salon_message_template_name — is sufficient.

DROP INDEX IF EXISTS "uq_salon_message_template";
