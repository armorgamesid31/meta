import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const accountId = "1009188595600173";
  const wabaId = "383236724881827";
  
  const b1 = await prisma.salonChannelBinding.findFirst({
    where: { externalAccountId: accountId }
  });
  const b2 = await prisma.salonChannelBinding.findFirst({
    where: { externalAccountId: wabaId }
  });

  console.log('Binding by PhoneNumberId:', b1?.salonId);
  console.log('Binding by WabaId:', b2?.salonId);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
