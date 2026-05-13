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
console.log('WABA:', wabaId);

const listUrl = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/api/v22.0/${wabaId}/message_templates?limit=1000&fields=name,status,category,language,id`;
const r = await axios.get(listUrl, {
  headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
  timeout: 30_000,
});

console.log('Response keys:', Object.keys(r.data));
console.log('Data count:', (r.data?.data || []).length);
console.log('Paging:', JSON.stringify(r.data?.paging));
for (const t of (r.data?.data || [])) {
  console.log(`  ${t.name.padEnd(40)} ${t.status.padEnd(10)} ${t.category} id=${t.id}`);
}
await prisma.$disconnect();
process.exit(0);
