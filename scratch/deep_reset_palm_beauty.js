import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgres://postgres:P2UgpcJy8uW1xgrv6ydoGs2XBEhF4ylOHOdOXq3YvNmZ9fKJFgbjDHQVJjSH6tEX@72.60.84.247:3000/salonasistan'
    }
  }
});

async function resetPalmBeauty() {
  try {
    const salon = await prisma.salon.findFirst({
      where: { name: { contains: 'Palm Beauty', mode: 'insensitive' } }
    });

    if (!salon) {
      console.log('Palm Beauty not found.');
      return;
    }

    console.log(`Deep Resetting Salon: ${salon.name} (ID: ${salon.id})`);

    // 1. Reset Salon table columns
    await prisma.salon.update({
      where: { id: salon.id },
      data: {
        chakraPluginId: null,
        chakraPhoneNumberId: null
      }
    });
    console.log('Main Salon table columns cleared.');

    // 2. Reset AI Agent Settings (FAQ Answers)
    const settings = await prisma.salonAiAgentSettings.findUnique({
      where: { salonId: salon.id }
    });

    if (settings && settings.faqAnswers) {
      const faqAnswers = settings.faqAnswers;
      
      // Clear Meta Direct store
      if (faqAnswers.metaDirect) {
        delete faqAnswers.metaDirect;
        console.log('faqAnswers.metaDirect cleared.');
      }
      
      // Clear Chakra legacy status flags in faqAnswers
      if (faqAnswers.whatsappPluginActive !== undefined) {
        delete faqAnswers.whatsappPluginActive;
        console.log('faqAnswers.whatsappPluginActive cleared.');
      }
      if (faqAnswers.whatsappPhoneNumberId !== undefined) {
        delete faqAnswers.whatsappPhoneNumberId;
        console.log('faqAnswers.whatsappPhoneNumberId cleared.');
      }

      await prisma.salonAiAgentSettings.update({
        where: { salonId: salon.id },
        data: { faqAnswers }
      });
      console.log('AI Settings faqAnswers fully updated.');
    }

    // 3. Delete channel bindings
    const bindings = await prisma.salonChannelBinding.deleteMany({
      where: { salonId: salon.id }
    });
    console.log(`Deleted ${bindings.count} channel bindings.`);

    console.log('SUCCESS: Palm Beauty deep reset completed.');

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await prisma.$disconnect();
  }
}

resetPalmBeauty();
