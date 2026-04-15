const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgres://postgres:P2UgpcJy8uW1xgrv6ydoGs2XBEhF4ylOHOdOXq3YvNmZ9fKJFgbjDHQVJjSH6tEX@72.60.84.247:3000/salonasistan'
});

async function checkColumns() {
  try {
    await client.connect();
    const res = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'SalonMessageTemplate';");
    console.log('COLUMNS:', JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    await client.end();
  }
}

checkColumns();
