// Daily retention cron — delete R2 objects + clear DB pointers for
// ConversationMessageEvent rows whose cached media is older than
// MEDIA_RETENTION_DAYS (default 30). Run via Coolify scheduled task:
//
//   0 3 * * *  node scripts/cleanup-cached-media.mjs
//
// Safe to run manually too. Logs counts of objects deleted + rows
// updated. The mediaItems metadata stays put — only the R2-cached
// bytes go away, so the chat history still renders a "expired" stub.

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  deleteFromR2,
  MEDIA_RETENTION_DAYS,
  isMediaCacheEnabled,
} from '../src/services/conversationMediaCache.js';

const prisma = new PrismaClient();

async function main() {
  if (!isMediaCacheEnabled()) {
    console.log('Media cache not configured — nothing to clean.');
    return;
  }

  const cutoff = new Date(Date.now() - MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  console.log(`Cleaning cached media older than ${cutoff.toISOString()} (${MEDIA_RETENTION_DAYS} days)`);

  const expired = await prisma.conversationMessageEvent.findMany({
    where: {
      mediaCachedAt: { lt: cutoff },
      NOT: { mediaCached: { equals: null as any } },
    },
    select: { id: true, mediaCached: true },
    take: 500, // process in batches; cron re-runs daily so backlog drains
  });

  console.log(`Found ${expired.length} rows with cached media to expire.`);

  let r2Deleted = 0;
  let r2Failed = 0;
  let rowsCleared = 0;

  for (const row of expired) {
    const cached = Array.isArray(row.mediaCached) ? row.mediaCached : [];
    for (const c of cached) {
      if (!c || typeof c !== 'object') continue;
      try {
        await deleteFromR2(c);
        r2Deleted++;
      } catch (err) {
        console.error(`  R2 delete failed for msg ${row.id}, key ${c.r2Key}:`, err?.message || err);
        r2Failed++;
      }
    }
    await prisma.conversationMessageEvent.update({
      where: { id: row.id },
      data: { mediaCached: null, mediaCachedAt: null },
    });
    rowsCleared++;
  }

  console.log(`Done. R2 objects deleted: ${r2Deleted}, failed: ${r2Failed}, rows cleared: ${rowsCleared}.`);
}

main()
  .catch((err) => {
    console.error('Cleanup failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
