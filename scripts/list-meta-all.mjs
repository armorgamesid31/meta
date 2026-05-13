// Follow Meta's pagination cursors to get the full template list.
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

let url = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/api/v22.0/${wabaId}/message_templates?limit=1000&fields=name,status,category,language,id`;
const all = [];
let page = 0;
while (url && page < 30) {
  page++;
  const r = await axios.get(url, {
    headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
    timeout: 30_000,
  });
  const data = r.data?.data || [];
  all.push(...data);
  console.log(`page ${page}: ${data.length} (running total: ${all.length})`);
  url = r.data?.paging?.next || null;
}

const byStatus = {};
for (const t of all) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
console.log('\nTotal:', all.length);
console.log('By status:', byStatus);

await prisma.$disconnect();
process.exit(0);
