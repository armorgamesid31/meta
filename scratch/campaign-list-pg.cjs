require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
    connectionTimeoutMillis: 10000,
  });
  await client.connect();
  const result = await client.query(`
    SELECT "id", "salonId", "name", "type", "status", "deliveryMode", "isActive", "startsAt", "endsAt", "createdAt"
    FROM "Campaign"
    ORDER BY "createdAt" DESC
  `);
  console.log(JSON.stringify(result.rows, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
