// Mark a known list of template names as CATEGORY_BUMPED + promote
// reserves. Used when Meta has bumped templates but the webhook didn't
// catch it (e.g. before we added template_category_update field support).

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const SALON_ID = 2;

// Names Meta has bumped to MARKETING (from user's panel screenshot).
// Unique-ified.
const BUMPED_NAMES = [...new Set([
  'kdy_google_maps_yorum_b1',
  'kdy_google_maps_yorum_b2',
  'kdy_google_maps_yorum_b3',
  'kdy_google_maps_yorum_b4',
  'kdy_google_maps_yorum_f1',
  'kdy_google_maps_yorum_f2',
  'kdy_google_maps_yorum_f3',
  'kdy_google_maps_yorum_f4',
  'kdy_memnuniyet_anketi_f2',
  'kdy_waitlist_teklif_b1',
  'kdy_waitlist_teklif_b3',
  'kdy_waitlist_teklif_b4',
  'kdy_waitlist_teklif_f1',
  'kdy_waitlist_teklif_f2',
  'kdy_waitlist_teklif_f3',
  'kdy_waitlist_teklif_f4',
  'kdy_waitlist_teklif_f5',
  'kdy_randevu_hatirlatma_2_saat_f2',
])];

const rows = await prisma.salonMessageTemplate.findMany({
  where: { salonId: SALON_ID, templateName: { in: BUMPED_NAMES } },
  select: {
    id: true, templateName: true, templateKey: true, tone: true,
    submissionState: true, rejectionReason: true,
  },
});

console.log(`Found ${rows.length} matching rows. Marking CATEGORY_BUMPED…`);
const keysToPromote = new Set();

for (const row of rows) {
  // Skip if already user_marked_outdated or already CATEGORY_BUMPED.
  if (row.submissionState === 'CATEGORY_BUMPED') {
    console.log(`  SKIP (already bumped): ${row.templateName}`);
    continue;
  }
  if (
    row.submissionState === 'REJECTED' &&
    typeof row.rejectionReason === 'string' &&
    row.rejectionReason.startsWith('user_marked_outdated')
  ) {
    console.log(`  SKIP (user_marked_outdated): ${row.templateName}`);
    continue;
  }

  await prisma.salonMessageTemplate.update({
    where: { id: row.id },
    data: {
      submissionState: 'CATEGORY_BUMPED',
      actualCategory: 'MARKETING',
      metaCategory: 'MARKETING',
      rejectionReason: 'category_bumped_reconciled_by_admin_to_MARKETING',
      lastSyncAt: new Date(),
    },
  });
  console.log(`  BUMPED: ${row.templateName} (${row.templateKey} / ${row.tone})`);
  if (row.templateKey && row.tone) {
    keysToPromote.add(`${row.templateKey}:${row.tone}`);
  }
}

console.log(`\nPromoting reserves for ${keysToPromote.size} (key, tone) pairs…`);

// Inline reserve promotion (avoids needing the dist build).
const ALL_TONES = ['FRIENDLY', 'BALANCED', 'PROFESSIONAL'];

// Map: tone → code
const toneCode = t => (t === 'FRIENDLY' ? 'f' : t === 'PROFESSIONAL' ? 'p' : 'b');

// We need the body for the new slot. Read templateVariations.ts indirectly
// via an existing row: pick a body from another row of same (key, tone)
// just to populate templateContent — actual content per slot comes from
// the next deploy. For now, leave templateContent empty/null and let the
// worker reject as "Missing template fields" if it tries; better path:
// don't promote inline, just record promote intent and let the webhook /
// sync endpoint handle it next time. But the webhook code calls
// promoteReserveVariation which reads templateVariations.ts (TS module),
// not accessible from this .mjs.
//
// Easier: trigger the existing /api/salon/templates/sync endpoint via an
// HTTP call. But that requires auth. Skip for now — log the pairs and
// recommend pressing the in-app "Şablonları Yeniden Senkronize Et"
// button which will auto-promote via the (now-fixed) sync route.

for (const k of keysToPromote) {
  console.log(`  → needs reserve promote: ${k}`);
}

console.log(`\nDone. Run the in-app "Şablonları Yeniden Senkronize Et" button to promote reserves.`);

await prisma.$disconnect();
