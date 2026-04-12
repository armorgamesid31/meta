import pkg from 'pg';
const { Client } = pkg;

async function checkUsers() {
  const client = new Client({
    connectionString: "postgresql://postgres:P2UgpcJy8uW1xgrv6ydoGs2XBEhF4ylOHOdOXq3YvNmZ9fKJFgbjDHQVJjSH6tEX@localhost:5432/salonasistan",
  });

  try {
    await client.connect();
    const res = await client.query('SELECT u.email, u."passwordHash", u.role, s.slug FROM "SalonUser" u JOIN "Salon" s ON u."salonId" = s.id LIMIT 5');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

checkUsers();
