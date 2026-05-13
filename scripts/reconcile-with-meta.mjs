// Reconcile DB rows with Meta truth. Rows that were wrongly marked
// REJECTED by the destructive sync-button bug (reason =
// user_marked_outdated_template_content) but still exist in Meta in
// PENDING/APPROVED status should be restored.
//
// Usage: node scripts/reconcile-with-meta.mjs <salonId>
import 'dotenv/config';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const SALON_ID = Number(process.argv[2] || 2);
const CHAKRA_API_BASE = process.env.CHAKRA_API_BASE || 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = process.env.CHAKRA_API_TOKEN;

const prisma = new PrismaClient();
const salon = await prisma.salon.findUnique({ where: { id: SALON_ID } });
const pluginRes = await axios.get(
  `${CHAKRA_API_BASE}/plugin/${salon.chakraPluginId}`,
  { headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` }, timeout: 15_000 }
);
const wabaId = Object.keys(pluginRes.data?._data?.auth?.whatsappBusinessAccountsById || {})[0];

const listUrl = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/api/v22.0/${wabaId}/message_templates?limit=1000&fields=name,status,category,language`;
const r = await axios.get(listUrl, {
  headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
  timeout: 30_000,
});
const metaTemplates = r.data?.data || [];
const metaByName = new Map(metaTemplates.map(t => [t.name, t]));
console.log(`Meta has ${metaTemplates.length} templates`);

// Look at ALL non-SUBMITTED, non-ACTIVE_VALID rows. If Meta has them
// PENDING/APPROVED, our local state is wrong — repair it.
const wrongRejected = await prisma.salonMessageTemplate.findMany({
  where: {
    salonId: SALON_ID,
    submissionState: { in: ['REJECTED', 'POOL_EXHAUSTED', 'NOT_QUEUED'] },
    templateName: { not: null },
  },
  select: { id: true, templateName: true, templateKey: true, tone: true },
});

let restored = 0;
let bumped = 0;
let truly = 0;
for (const row of wrongRejected) {
  const meta = metaByName.get(row.templateName);
  if (!meta) { truly++; continue; }

  if (meta.status === 'APPROVED' || meta.status === 'PENDING') {
    const isBumped = meta.category === 'MARKETING';
    await prisma.salonMessageTemplate.update({
      where: { id: row.id },
      data: {
        submissionState: meta.status === 'APPROVED'
          ? (isBumped ? 'CATEGORY_BUMPED' : 'ACTIVE_VALID')
          : 'SUBMITTED',
        rejectionReason: null,
        rejectedAt: null,
        metaStatus: meta.status,
        metaCategory: meta.category,
        actualCategory: meta.category,
      },
    });
    if (isBumped) bumped++; else restored++;
  } else {
    truly++;
  }
}

console.log(`Restored: ${restored} (still pending/approved)`);
console.log(`Bumped to CATEGORY_BUMPED: ${bumped}`);
console.log(`Genuinely gone from Meta: ${truly} (left as REJECTED)`);
await prisma.$disconnect();
process.exit(0);
