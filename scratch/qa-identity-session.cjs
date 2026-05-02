require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: false, connectionTimeoutMillis: 10000 });
  await c.connect();
  const { rows } = await c.query(`SELECT "id","salonId","channel","subjectType","subjectNormalized","customerId" FROM "IdentitySession" WHERE "customerId" IS NOT NULL ORDER BY "updatedAt" DESC NULLS LAST LIMIT 1`);
  console.log(JSON.stringify(rows));
  await c.end();
})();
