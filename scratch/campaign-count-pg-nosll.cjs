require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
    connectionTimeoutMillis: 10000,
  });
  await client.connect();
  const result = await client.query('SELECT COUNT(*)::int AS total FROM "Campaign"');
  console.log(JSON.stringify(result.rows, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exitCode = 1;
});
