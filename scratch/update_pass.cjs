const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgres://postgres:P2UgpcJy8uW1xgrv6ydoGs2XBEhF4ylOHOdOXq3YvNmZ9fKJFgbjDHQVJjSH6tEX@72.60.84.247:3000/salonasistan'
});

async function updatePassword() {
  try {
    await client.connect();
    // Hash for '123456'
    const hash = '$2b$10$bA8XADCuv/fen9HShUSYZuhEOIQAX3cpN2O2YM5o6pcKr52sr7a5u';
    await client.query("UPDATE \"SalonUser\" SET \"passwordHash\" = $1 WHERE id = 4;", [hash]);
    console.log('Password updated for user 4.');
  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    await client.end();
  }
}

updatePassword();
