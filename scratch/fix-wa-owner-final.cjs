const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
dotenv.config();

const prisma = new PrismaClient();

(async () => {
  const phoneId = '1009188595600173';

  await prisma.$transaction(async (tx) => {
    // Move (or create) WhatsApp binding to salon 8
    await tx.salonChannelBinding.upsert({
      where: {
        channel_externalAccountId: {
          channel: 'WHATSAPP',
          externalAccountId: phoneId,
        },
      },
      update: {
        salonId: 8,
        isActive: true,
      },
      create: {
        salonId: 8,
        channel: 'WHATSAPP',
        externalAccountId: phoneId,
        isActive: true,
      },
    });

    // Remove stale ownership from salon 2 so it cannot resurrect by local state
    await tx.salon.update({
      where: { id: 2 },
      data: {
        chakraPluginId: null,
        chakraPhoneNumberId: null,
      },
    });

    await tx.salon.update({
      where: { id: 8 },
      data: {
        chakraPhoneNumberId: phoneId,
      },
    });

    await tx.salonAiAgentSettings.upsert({
      where: { salonId: 2 },
      update: {
        faqAnswers: {
          whatsappPluginActive: false,
          whatsappPhoneNumberId: null,
        },
      },
      create: {
        salonId: 2,
        faqAnswers: {
          whatsappPluginActive: false,
          whatsappPhoneNumberId: null,
        },
      },
    });
  });

  const salon2 = await prisma.salon.findUnique({ where: { id: 2 }, select: { id: true, chakraPluginId: true, chakraPhoneNumberId: true } });
  const salon8 = await prisma.salon.findUnique({ where: { id: 8 }, select: { id: true, chakraPluginId: true, chakraPhoneNumberId: true } });
  const bindings = await prisma.salonChannelBinding.findMany({
    where: { channel: 'WHATSAPP', salonId: { in: [2, 8] } },
    select: { id: true, salonId: true, externalAccountId: true, isActive: true, updatedAt: true },
    orderBy: [{ salonId: 'asc' }, { updatedAt: 'desc' }],
  });

  console.log(JSON.stringify({ salon2, salon8, bindings }, null, 2));
  await prisma.$disconnect();
})();
