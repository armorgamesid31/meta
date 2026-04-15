import pkg from 'pg';
const { Client } = pkg;

async function findMagicLink() {
  const client = new Client({
    connectionString: "postgresql://postgres:P2UgpcJy8uW1xgrv6ydoGs2XBEhF4ylOHOdOXq3YvNmZ9fKJFgbjDHQVJjSH6tEX@localhost:5432/salonasistan",
  });

  try {
    await client.connect();
    // Find a magic link that hasn't expired and belongs to a salon with a loyalty campaign
    const res = await client.query(`
      SELECT ml.token, s.slug, c.name as campaign_name
      FROM "MagicLink" ml
      JOIN "Salon" s ON ml."salonId" = s.id
      JOIN "Campaign" c ON c."salonId" = s.id
      WHERE ml."expiresAt" > NOW()
      AND c.type = 'LOYALTY'
      LIMIT 1
    `);
    
    if (res.rows.length === 0) {
      // Fallback: just find any valid magic link
      const fallback = await client.query(`
        SELECT ml.token, s.slug 
        FROM "MagicLink" ml
        JOIN "Salon" s ON ml."salonId" = s.id
        WHERE ml."expiresAt" > NOW()
        LIMIT 1
      `);
      console.log(JSON.stringify(fallback.rows, null, 2));
    } else {
      console.log(JSON.stringify(res.rows, null, 2));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

findMagicLink();
