// One-shot reconciliation: rows that Meta has category-bumped but our
// webhook didn't catch (because we previously only listened for
// message_template_status_update). Fetches Meta's current view of each
// SUBMITTED template, compares category, marks bumped rows CATEGORY_BUMPED
// and triggers reserve promotion.

import axios from 'axios';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const SALON_ID = Number(process.argv[2] || 2);
const CHAKRA_API_BASE = 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = process.env.CHAKRA_API_TOKEN || '';

if (!CHAKRA_API_TOKEN) {
  console.error('CHAKRA_API_TOKEN missing');
  process.exit(1);
}

const salon = await prisma.salon.findUnique({
  where: { id: SALON_ID },
  select: { id: true, name: true, chakraPluginId: true },
});
if (!salon?.chakraPluginId) {
  console.error('Salon has no chakraPluginId');
  process.exit(1);
}

// Resolve WABA id.
const pluginRes = await axios.get(
  `${CHAKRA_API_BASE}/plugin/${salon.chakraPluginId}`,
  { headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` }, timeout: 15_000 }
);
const wabaMap = pluginRes?.data?._data?.auth?.whatsappBusinessAccountsById;
const wabaId = wabaMap ? Object.keys(wabaMap)[0] : null;
if (!wabaId) {
  console.error('No WABA bound to plugin');
  process.exit(1);
}

// Fetch all templates from Meta for this WABA.
const templatesUrl = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/api/v22.0/${wabaId}/message_templates?limit=200`;
const tres = await axios.get(templatesUrl, {
  headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
  timeout: 30_000,
});
const metaTemplates = tres?.data?.data || tres?.data?._data || [];
console.log(`Meta has ${metaTemplates.length} templates for WABA ${wabaId}`);

const byName = new Map();
for (const t of metaTemplates) byName.set(t.name, t);

// Walk our DB rows and detect category mismatches.
const dbRows = await prisma.salonMessageTemplate.findMany({
  where: { salonId: SALON_ID, templateKey: { not: null } },
  select: {
    id: true, templateName: true, templateKey: true, tone: true,
    submissionState: true, expectedCategory: true, actualCategory: true,
    metaCategory: true,
  },
});

let bumped = 0;
let approved = 0;
let alreadyHandled = 0;
const promotePerKeyTone = new Set();

for (const row of dbRows) {
  if (!row.templateName) continue;
  const meta = byName.get(row.templateName);
  if (!meta) continue;

  const metaCat = String(meta.category || '').toUpperCase();
  const expected = String(row.expectedCategory || 'UTILITY').toUpperCase();

  // Skip user_marked_outdated rows.
  if (row.submissionState === 'REJECTED') {
    alreadyHandled++;
    continue;
  }

  if (metaCat && metaCat !== expected) {
    // Bumped — update state.
    if (row.submissionState === 'CATEGORY_BUMPED') {
      // Already marked.
      continue;
    }
    await prisma.salonMessageTemplate.update({
      where: { id: row.id },
      data: {
        submissionState: 'CATEGORY_BUMPED',
        actualCategory: metaCat,
        metaCategory: metaCat,
        rejectionReason: `category_bumped_reconciled_from_${expected}_to_${metaCat}`,
        lastSyncAt: new Date(),
      },
    });
    bumped++;
    promotePerKeyTone.add(`${row.templateKey}:${row.tone}`);
    console.log(`  BUMPED: ${row.templateName} ${expected} → ${metaCat}`);
  } else if (meta.status === 'APPROVED' && row.submissionState !== 'ACTIVE_VALID') {
    // Meta approved, category matches — promote to ACTIVE_VALID.
    await prisma.salonMessageTemplate.update({
      where: { id: row.id },
      data: {
        submissionState: 'ACTIVE_VALID',
        actualCategory: metaCat || expected,
        metaCategory: metaCat || expected,
        metaStatus: 'APPROVED',
        approvedAt: new Date(),
        rejectionReason: null,
      },
    });
    approved++;
    console.log(`  APPROVED: ${row.templateName}`);
  }
}

console.log(`\nSummary: bumped=${bumped}, approved=${approved}, skipped_user_marked=${alreadyHandled}`);

// Promote reserves for bumped (key, tone) pairs.
if (promotePerKeyTone.size > 0) {
  const { promoteReserveVariation } = await import('../dist/services/salonTemplateSubmitter.js')
    .catch(async () => {
      // Fallback: use the source via tsx
      const m = await import('../src/services/salonTemplateSubmitter.ts');
      return m;
    });

  let promoted = 0;
  for (const k of promotePerKeyTone) {
    const [logicalKey, tone] = k.split(':');
    const res = await promoteReserveVariation({
      salonId: SALON_ID,
      logicalKey,
      tone,
    });
    if (res.created) {
      promoted++;
      console.log(`  promoted reserve slot ${res.slot} for ${logicalKey} (${tone})`);
    }
  }
  console.log(`\nPromoted ${promoted} reserve slots.`);
}

await prisma.$disconnect();
