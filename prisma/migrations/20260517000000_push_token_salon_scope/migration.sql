-- Push device tokens are now scoped per (platform, token, salonId).
-- Previously a single (platform, token) row meant that when the same physical
-- device logged into a second salon, the row was overwritten and the original
-- salon's push notifications silently stopped reaching that device.

ALTER TABLE "PushDeviceToken"
  DROP CONSTRAINT IF EXISTS "uq_push_device_platform_token";

DROP INDEX IF EXISTS "uq_push_device_platform_token";

ALTER TABLE "PushDeviceToken"
  ADD CONSTRAINT "uq_push_device_platform_token_salon"
  UNIQUE ("platform", "token", "salonId");
