const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgres://postgres:P2UgpcJy8uW1xgrv6ydoGs2XBEhF4ylOHOdOXq3YvNmZ9fKJFgbjDHQVJjSH6tEX@72.60.84.247:3000/salonasistan'
});

async function getUsers() {
  try {
    await client.connect();
    const res = await client.query("SELECT id, email, role FROM \"SalonUser\" WHERE \"salonId\" = 2;");
    console.log('USERS:', JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    await client.end();
  }
}

getUsers();
