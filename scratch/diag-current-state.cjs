const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
dotenv.config();
const prisma = new PrismaClient();
(async()=>{
  const salons = await prisma.salon.findMany({
    where:{ id:{ in:[2,8]}},
    select:{ id:true,name:true,chakraPluginId:true,chakraPhoneNumberId:true }
  });
  const waBindings = await prisma.salonChannelBinding.findMany({
    where:{ channel:'WHATSAPP', salonId:{ in:[2,8]} },
    select:{ id:true,salonId:true,externalAccountId:true,isActive:true,updatedAt:true },
    orderBy:[{updatedAt:'desc'}]
  });
  const igBindings = await prisma.salonChannelBinding.findMany({
    where:{ channel:'INSTAGRAM', salonId:{ in:[2,8]} },
    select:{ id:true,salonId:true,externalAccountId:true,isActive:true,updatedAt:true },
    orderBy:[{updatedAt:'desc'}]
  });
  console.log(JSON.stringify({salons,waBindings,igBindings},null,2));
  await prisma.$disconnect();
})();
