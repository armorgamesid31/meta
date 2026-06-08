-- ConversationState.pendingLocationAt
-- AI agent konum CTA'sı için. Müşteri konum/adres sorduğunda tool_request_location
-- bu alana now() yazar; agent-outbound/send butonu (Google Maps URL) AI'ın cevabına
-- gömüp tek mesajda yollar ve alanı temizler — booking magic-link deseniyle aynı.
-- Idempotent: elle psql ile uygulanır (prisma migrate dev shadow-DB drift'te fail eder).
ALTER TABLE "ConversationState"
  ADD COLUMN IF NOT EXISTS "pendingLocationAt" TIMESTAMP(6);
