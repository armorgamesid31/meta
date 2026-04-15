import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from parent dir
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Client } = pg;

const sql = `
ALTER TABLE "SalonMessageTemplate" 
ADD COLUMN IF NOT EXISTS "externalId" TEXT,
ADD COLUMN IF NOT EXISTS "metaCategory" TEXT,
ADD COLUMN IF NOT EXISTS "metaStatus" TEXT,
ADD COLUMN IF NOT EXISTS "lastSyncAt" TIMESTAMP(6);
`;

async function applyMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not found in .env');
    process.exit(1);
  }

  console.log('Connecting to database...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false } // Common for cloud DBs
  });

  try {
    await client.connect();
    console.log('Connected. Running migration...');
    await client.query(sql);
    console.log('Migration completed successfully!');
    
    // Check if columns exist
    const res = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'SalonMessageTemplate' 
      AND column_name IN ('externalId', 'metaCategory', 'metaStatus', 'lastSyncAt');
    `);
    console.log('Existing/Added columns:', res.rows.map(r => r.column_name));

  } catch (err) {
    console.error('Migration failed:', err.message);
    if (err.message.includes('ETIMEDOUT') || err.message.includes('ECONNREFUSED')) {
      console.error('\nNOTE: Connection timed out. This likely means your IP is NOT whitelisted on the production database.');
    }
  } finally {
    await client.end();
  }
}

applyMigration();
