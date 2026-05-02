require('dotenv').config();
const { Client } = require('pg');
(async()=>{
 const c=new Client({connectionString:process.env.DATABASE_URL,ssl:false,connectionTimeoutMillis:10000});
 await c.connect();
 const salonId=2;
 const existing=await c.query(`SELECT "id","name" FROM "Campaign" WHERE "salonId"=$1 AND "type"='REFERRAL'::"CampaignType" AND "isActive"=true ORDER BY "id" DESC LIMIT 1`,[salonId]);
 if(existing.rows[0]){ console.log(JSON.stringify({existing:true,id:existing.rows[0].id,name:existing.rows[0].name})); await c.end(); return; }
 const cfg={ rewardType:'discount_percent', rewardValue:10, referrerRewardValue:10, referredCustomerRewardValue:15, activationTiming:'after_first_completed', combineWithWelcomeCampaign:false, eligibleServiceIds:[], excludedServiceIds:[] };
 const ins=await c.query(`INSERT INTO "Campaign" ("salonId","name","type","description","config","isActive","lifecycleStatus","priority","deliveryMode","createdAt","updatedAt") VALUES ($1,$2,'REFERRAL'::"CampaignType",$3,$4::jsonb,true,'ACTIVE'::"CampaignLifecycleStatus",100,'MANUAL'::"CampaignDeliveryMode",NOW(),NOW()) RETURNING "id","name"`,[salonId,'Referans Kampanyası QA', 'QA referral test campaign', JSON.stringify(cfg)]);
 console.log(JSON.stringify({created:true,id:ins.rows[0].id,name:ins.rows[0].name}));
 await c.end();
})();
