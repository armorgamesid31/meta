-- Voice message transcript persisted from n8n's existing OpenAI Whisper
-- transcription step in the AI agent workflow. We just plumb the
-- transcript back so the salon staff sees it in the UI without burning
-- a second Whisper call.

ALTER TABLE "ConversationMessageEvent"
  ADD COLUMN IF NOT EXISTS "voiceTranscript"     TEXT,
  ADD COLUMN IF NOT EXISTS "voiceTranscriptLang" TEXT,
  ADD COLUMN IF NOT EXISTS "voiceTranscriptAt"   TIMESTAMP(6);
