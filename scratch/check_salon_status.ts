import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgres://postgres:P2UgpcJy8uW1xgrv6ydoGs2XBEhF4ylOHOdOXq3YvNmZ9fKJFgbjDHQVJjSH6tEX@72.60.84.247:3000/salonasistan"
    }
  }
});

async function main() {
  const salon = await prisma.salon.findUnique({
    where: { id: 2 },
    select: {
      id: true,
      name: true,
      chakraPluginId: true,
      chakraPhoneNumberId: true,
      aiAgentSettings: true
    }
  });
  console.log(JSON.stringify(salon, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
