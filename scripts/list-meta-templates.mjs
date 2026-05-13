// List all WhatsApp templates currently registered with Meta for the
// given salon's WABA, via Chakra proxy. Helps diagnose "Content
// already exists" errors after a manual cleanup.
//
// Usage: node scripts/list-meta-templates.mjs <salonId>
import 'dotenv/config';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const SALON_ID = Number(process.argv[2] || 2);
const CHAKRA_API_BASE = process.env.CHAKRA_API_BASE || 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = process.env.CHAKRA_API_TOKEN;

if (!CHAKRA_API_TOKEN) {
  console.error('CHAKRA_API_TOKEN missing from env');
  process.exit(1);
}

const prisma = new PrismaClient();
const salon = await prisma.salon.findUnique({ where: { id: SALON_ID } });
if (!salon || !salon.chakraPluginId) {
  console.error('Salon or pluginId not found');
  process.exit(1);
}

const pluginRes = await axios.get(
  `${CHAKRA_API_BASE}/plugin/${salon.chakraPluginId}`,
  { headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` }, timeout: 15_000 }
);
const wabaMap = pluginRes?.data?._data?.auth?.whatsappBusinessAccountsById;
const wabaId = wabaMap ? Object.keys(wabaMap)[0] : null;
if (!wabaId) { console.error('No WABA bound'); process.exit(1); }

console.log('WABA:', wabaId);

const listUrl = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/api/v22.0/${wabaId}/message_templates?limit=200`;
const r = await axios.get(listUrl, {
  headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
  timeout: 30_000,
});

const data = r.data?.data || [];
console.log(`Total templates registered with Meta: ${data.length}`);
for (const t of data) {
  console.log(`  ${t.name.padEnd(40)} status=${t.status.padEnd(10)} category=${t.category}`);
}
await prisma.$disconnect();
process.exit(0);
