import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const salonId = 2;
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: {
      id: true,
      name: true,
      chakraPluginId: true,
      chakraPhoneNumberId: true,
      metaInstagramId: true,
    }
  });

  console.log('Salon 2 Details:', JSON.stringify(salon, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
