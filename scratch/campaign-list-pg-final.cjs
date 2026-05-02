require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: false, connectionTimeoutMillis: 10000 });
  await client.connect();
  const { rows } = await client.query('SELECT "id", "salonId", "name", "type", "lifecycleStatus", "deliveryMode", "isActive", "startsAt", "endsAt", "publishedAt", "createdAt" FROM "Campaign" ORDER BY "createdAt" DESC LIMIT 50');
  console.log(JSON.stringify(rows, null, 2));
  await client.end();
  process.exit(0);
})().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
