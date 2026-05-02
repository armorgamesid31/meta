const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
dotenv.config();
const prisma = new PrismaClient();
(async()=>{
  const rows = await prisma.salonChannelBinding.findMany({
    where:{ salonId:2, channel:'WHATSAPP' },
    select:{ id:true, externalAccountId:true, isActive:true, updatedAt:true }
  });
  const rows8 = await prisma.salonChannelBinding.findMany({
    where:{ salonId:8, channel:'WHATSAPP' },
    select:{ id:true, externalAccountId:true, isActive:true, updatedAt:true }
  });
  const salon2 = await prisma.salon.findUnique({where:{id:2}, select:{id:true,chakraPluginId:true,chakraPhoneNumberId:true}});
  const salon8 = await prisma.salon.findUnique({where:{id:8}, select:{id:true,chakraPluginId:true,chakraPhoneNumberId:true}});
  console.log(JSON.stringify({salon2,salon8,rows,rows8},null,2));
  await prisma.$disconnect();
})();
