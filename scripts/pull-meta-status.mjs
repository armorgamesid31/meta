// Pull current Meta status for every template and update our DB
// accordingly. Mirror of the webhook handler but pull-based, for when
// Meta webhook hasn't fired or webhook configuration is missing.
//
// Mapping:
//   Meta APPROVED + UTILITY (expected)  → ACTIVE_VALID
//   Meta APPROVED + MARKETING (bumped)  → CATEGORY_BUMPED
//   Meta PENDING                        → SUBMITTED
//   Meta REJECTED                       → REJECTED
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

let url = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/api/v22.0/${wabaId}/message_templates?limit=1000&fields=name,status,category`;
const meta = new Map();
while (url) {
  const r = await axios.get(url, { headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` }, timeout: 30_000 });
  for (const t of (r.data?.data || [])) meta.set(t.name, t);
  url = r.data?.paging?.next || null;
}
console.log(`Meta has ${meta.size} templates`);

const rows = await prisma.salonMessageTemplate.findMany({
  where: { salonId: SALON_ID, templateName: { not: null } },
  select: { id: true, templateName: true, expectedCategory: true, submissionState: true },
});

const counts = { active: 0, bumped: 0, pending: 0, rejected: 0, untouched: 0 };
for (const row of rows) {
  const m = meta.get(row.templateName);
  if (!m) { counts.untouched++; continue; }

  const expected = row.expectedCategory || 'UTILITY';
  const isBumped = m.category && m.category !== expected;
  let newState = row.submissionState;

  if (m.status === 'APPROVED') {
    newState = isBumped ? 'CATEGORY_BUMPED' : 'ACTIVE_VALID';
    if (isBumped) counts.bumped++; else counts.active++;
  } else if (m.status === 'PENDING') {
    newState = 'SUBMITTED';
    counts.pending++;
  } else if (m.status === 'REJECTED') {
    newState = 'REJECTED';
    counts.rejected++;
  }

  if (newState !== row.submissionState) {
    await prisma.salonMessageTemplate.update({
      where: { id: row.id },
      data: {
        submissionState: newState,
        metaStatus: m.status,
        metaCategory: m.category,
        actualCategory: m.category,
        ...(newState === 'ACTIVE_VALID' ? { approvedAt: new Date() } : {}),
      },
    });
  }
}

console.log('Counts:', counts);
await prisma.$disconnect();
process.exit(0);
