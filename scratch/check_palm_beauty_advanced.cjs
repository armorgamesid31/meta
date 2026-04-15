const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgres://postgres:P2UgpcJy8uW1xgrv6ydoGs2XBEhF4ylOHOdOXq3YvNmZ9fKJFgbjDHQVJjSH6tEX@72.60.84.247:3000/salonasistan'
    }
  }
});

async function main() {
  const salon = await prisma.salon.findFirst({
    where: { slug: 'palmbeauty' },
    include: {
      aiAgentSettings: true
    }
  });

  if (!salon) {
    console.log('Salon not found');
    return;
  }

  console.log('--- SALON INFO ---');
  console.log('ID:', salon.id);
  console.log('Name:', salon.name);
  console.log('BookingMode:', salon.bookingMode);
  console.log('ChakraPluginId:', salon.chakraPluginId);
  console.log('ChakraPhoneNumberId:', salon.chakraPhoneNumberId);
  console.log('Created At:', salon.createdAt);

  console.log('--- AI AGENT SETTINGS ---');
  if (salon.aiAgentSettings) {
    console.log('ID:', salon.aiAgentSettings.id);
    console.log('FaqAnswers (keys):', Object.keys(salon.aiAgentSettings.faqAnswers || {}));
    console.log('FaqAnswers:', JSON.stringify(salon.aiAgentSettings.faqAnswers, null, 2));
  } else {
    console.log('No AI agent settings found');
  }

  console.log('--- CHANNEL BINDINGS ---');
  const bindings = await prisma.salonChannelBinding.findMany({
    where: { salonId: salon.id }
  });
  console.log('Count:', bindings.length);
  bindings.forEach(b => {
    console.log(`- Type: ${b.type}, Provider: ${b.provider}, ExternalId: ${b.externalId}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
