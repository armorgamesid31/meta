// Internal enrichment endpoints called from n8n's AI agent workflow.
//
// POST /messages/transcript
//   Body: { providerMessageId: string, channel: 'WHATSAPP'|'INSTAGRAM',
//           transcript: string, lang?: string }
//   Writes the n8n-produced Whisper transcript onto the matching
//   ConversationMessageEvent row so the mobile chat surface can render
//   it under the voice waveform. Idempotent — re-runs just refresh the
//   text and timestamp.
//
// Auth: x-internal-api-key header (shared secret with n8n).

import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

router.post('/messages/transcript', async (req: any, res: any) => {
  const providerMessageId = typeof req.body?.providerMessageId === 'string'
    ? req.body.providerMessageId.trim()
    : '';
  const channelRaw = typeof req.body?.channel === 'string'
    ? req.body.channel.trim().toUpperCase()
    : '';
  const transcript = typeof req.body?.transcript === 'string'
    ? req.body.transcript.trim()
    : '';
  const lang = typeof req.body?.lang === 'string'
    ? req.body.lang.trim().slice(0, 8) || null
    : null;

  if (!providerMessageId || !transcript || (channelRaw !== 'WHATSAPP' && channelRaw !== 'INSTAGRAM')) {
    return res.status(400).json({
      ok: false,
      error: 'providerMessageId, channel (WHATSAPP|INSTAGRAM) ve transcript zorunlu.',
    });
  }

  const result = await prisma.conversationMessageEvent.updateMany({
    where: {
      channel: channelRaw as 'WHATSAPP' | 'INSTAGRAM',
      providerMessageId,
    },
    data: {
      voiceTranscript: transcript.slice(0, 8000), // sanity cap
      voiceTranscriptLang: lang,
      voiceTranscriptAt: new Date(),
    },
  });

  if (result.count === 0) {
    return res.status(404).json({ ok: false, error: 'Message not found.' });
  }

  return res.status(200).json({ ok: true, updated: result.count });
});

export default router;
