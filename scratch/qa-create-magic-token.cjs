require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: false, connectionTimeoutMillis: 10000 });
  await c.connect();

  const sess = (await c.query(`SELECT "id","salonId","channel","subjectType","subjectNormalized","customerId" FROM "IdentitySession" WHERE "customerId" IS NOT NULL ORDER BY "updatedAt" DESC NULLS LAST LIMIT 1`)).rows[0];
  if (!sess) throw new Error('No identity session with customer found');
  const cust = (await c.query(`SELECT "phone" FROM "Customer" WHERE "id"=$1 LIMIT 1`, [sess.customerId])).rows[0];
  const token = `qa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;

  await c.query(
    `INSERT INTO "MagicLink" ("token","phone","type","context","expiresAt","salonId","channel","subjectType","subjectNormalized","status","identitySessionId","usedByCustomerId","createdAt","updatedAt")
     VALUES ($1,$2,'BOOKING',$3::jsonb,NOW() + interval '2 day',$4,$5,$6,$7,'ACTIVE',$8,$9,NOW(),NOW())`,
    [token, String(cust?.phone || ''), JSON.stringify({ source: 'qa-referral-check' }), Number(sess.salonId), String(sess.channel), String(sess.subjectType), String(sess.subjectNormalized), String(sess.id), Number(sess.customerId)]
  );

  console.log(JSON.stringify({ token, salonId: Number(sess.salonId), customerId: Number(sess.customerId) }));
  await c.end();
})();

