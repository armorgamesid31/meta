const { PrismaClient } = require('@prisma/client');
const { syncAndEnsureMasterTemplates } = require('../src/services/chakra'); // Adjust path if needed
const prisma = new PrismaClient();

async function main() {
  const salon = await prisma.salon.findUnique({
    where: { id: 2 }
  });
  
  if (!salon) {
    console.error('Salon not found');
    return;
  }
  
  console.log('SYNCING FOR SALON:', salon.name, 'PLUGIN:', salon.chakraPluginId);
  
  try {
    const result = await syncAndEnsureMasterTemplates(salon);
    console.log('SYNC_RESULT:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('SYNC_ERROR:', err);
    if (err.response) {
      console.error('RESPONSE_DATA:', JSON.stringify(err.response.data, null, 2));
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
