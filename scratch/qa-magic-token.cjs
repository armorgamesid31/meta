require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: false, connectionTimeoutMillis: 10000 });
  await c.connect();
  const q = `
    SELECT "token", "salonId", "usedByCustomerId", "expiresAt", "status", "createdAt"
    FROM "MagicLink"
    WHERE "status"='ACTIVE'
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
      AND "usedByCustomerId" IS NOT NULL
    ORDER BY "createdAt" DESC
    LIMIT 5
  `;
  const { rows } = await c.query(q);
  console.log(JSON.stringify(rows));
  await c.end();
})();
