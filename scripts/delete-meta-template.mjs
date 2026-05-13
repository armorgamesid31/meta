// Delete a Meta-side template by name for the given salon's WABA.
// Usage: node scripts/delete-meta-template.mjs <salonId> <templateName>
import 'dotenv/config';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const SALON_ID = Number(process.argv[2] || 2);
const NAME = process.argv[3];
if (!NAME) { console.error('templateName required'); process.exit(1); }

const CHAKRA_API_BASE = process.env.CHAKRA_API_BASE || 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = process.env.CHAKRA_API_TOKEN;
if (!CHAKRA_API_TOKEN) { console.error('CHAKRA_API_TOKEN missing'); process.exit(1); }

const prisma = new PrismaClient();
const salon = await prisma.salon.findUnique({ where: { id: SALON_ID } });
const pluginRes = await axios.get(
  `${CHAKRA_API_BASE}/plugin/${salon.chakraPluginId}`,
  { headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` }, timeout: 15_000 }
);
const wabaId = Object.keys(pluginRes.data?._data?.auth?.whatsappBusinessAccountsById || {})[0];

const url = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/api/v22.0/${wabaId}/message_templates?name=${encodeURIComponent(NAME)}`;
const r = await axios.delete(url, {
  headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
  timeout: 30_000,
});
console.log('Delete result:', JSON.stringify(r.data));
await prisma.$disconnect();
process.exit(0);
