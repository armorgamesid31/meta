/**
 * Reset WhatsApp configuration for Palm Beauty (Salon ID: 2)
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function reset() {
  const salonId = 2;
  console.log(`Starting reset for Salon ID: ${salonId} (Palm Beauty)...`);

  // 1. Reset Salon fields
  const updatedSalon = await prisma.salon.update({
    where: { id: salonId },
    data: {
      chakraPluginId: null,
      chakraPhoneNumberId: null
    }
  });
  console.log('✅ Salon configuration nullified.');

  // 2. Delete Channel Bindings
  const deletedBindings = await prisma.salonChannelBinding.deleteMany({
    where: { salonId }
  });
  console.log(`✅ Deleted ${deletedBindings.count} channel bindings.`);

  // 3. Delete Templates
  const deletedTemplates = await prisma.salonMessageTemplate.deleteMany({
    where: { salonId }
  });
  console.log(`✅ Deleted ${deletedTemplates.count} message templates.`);

  console.log('🚀 Reset complete. Palm Beauty is ready for a fresh WhatsApp setup.');
}

reset()
  .catch((e) => {
    console.error('❌ Reset failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
