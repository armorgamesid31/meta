const { Client } = require('pg');

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  const result = await client.query(
    `SELECT "id","salonId","channel","externalAccountId","isActive","updatedAt"
     FROM "SalonChannelBinding"
     WHERE "channel" = $1 AND "salonId" = ANY($2::int[])
     ORDER BY "externalAccountId", "updatedAt" DESC`,
    ['INSTAGRAM', [2, 8]],
  );

  console.log(JSON.stringify(result.rows, null, 2));
  await client.end();
})();
