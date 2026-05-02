require('dotenv').config();
const { Client } = require('pg');
(async()=>{
 const c=new Client({connectionString:process.env.DATABASE_URL,ssl:false,connectionTimeoutMillis:10000});
 await c.connect();
 const r=await c.query(`SELECT "token","salonId","usedByCustomerId","expiresAt","status" FROM "MagicLink" WHERE "salonId"=2 AND "type"='BOOKING'::"MagicLinkType" AND "channel"='INSTAGRAM'::"ChannelType" AND "subjectNormalized"='774258075213757' ORDER BY "createdAt" DESC LIMIT 1`);
 console.log(JSON.stringify(r.rows));
 if(r.rows[0]){
   await c.query(`UPDATE "MagicLink" SET "status"='ACTIVE'::"MagicLinkStatus", "expiresAt"=NOW()+interval '2 day', "usedAt"=NULL, "updatedAt"=NOW() WHERE "token"=$1`, [r.rows[0].token]);
   const r2=await c.query(`SELECT "token","salonId","usedByCustomerId","expiresAt","status" FROM "MagicLink" WHERE "token"=$1`, [r.rows[0].token]);
   console.log(JSON.stringify({qaToken:r2.rows[0]}));
 }
 await c.end();
})();
