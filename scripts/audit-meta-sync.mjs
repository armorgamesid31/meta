// Audit: are our SUBMITTED rows actually in Meta?
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

// Pull full meta list via pagination
let url = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/api/v22.0/${wabaId}/message_templates?limit=1000&fields=name,status,category`;
const metaSet = new Set();
const metaByName = new Map();
while (url) {
  const r = await axios.get(url, { headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` }, timeout: 30_000 });
  for (const t of (r.data?.data || [])) {
    metaSet.add(t.name);
    metaByName.set(t.name, t);
  }
  url = r.data?.paging?.next || null;
}

const submitted = await prisma.salonMessageTemplate.findMany({
  where: { salonId: SALON_ID, submissionState: 'SUBMITTED' },
  select: { templateName: true },
});

let inMeta = 0;
const missing = [];
for (const row of submitted) {
  if (metaSet.has(row.templateName)) inMeta++;
  else missing.push(row.templateName);
}

console.log(`DB SUBMITTED: ${submitted.length}`);
console.log(`Meta has: ${metaSet.size}`);
console.log(`SUBMITTED rows present in Meta: ${inMeta}`);
console.log(`SUBMITTED rows MISSING from Meta: ${missing.length}`);
if (missing.length > 0) {
  console.log('\nMissing (DB thinks submitted, Meta has nothing):');
  for (const n of missing.slice(0, 30)) console.log('  ' + n);
}

// Also flag ghost: Meta has it but DB doesn't track as SUBMITTED
const dbNames = new Set(submitted.map(r => r.templateName));
const ghosts = [...metaSet].filter(n => !dbNames.has(n));
if (ghosts.length > 0) {
  console.log('\nGhosts (Meta has, DB not SUBMITTED):');
  for (const n of ghosts.slice(0, 30)) console.log('  ' + n + ' [' + metaByName.get(n).status + ']');
}

await prisma.$disconnect();
process.exit(0);
