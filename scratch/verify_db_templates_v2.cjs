const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verify() {
  const salonId = 2; // Palm Beauty
  const templates = await prisma.salonMessageTemplate.findMany({
    where: { salonId }
  });
  
  console.log(`Salon ${salonId} has ${templates.length} templates in DB.`);
  templates.forEach(t => {
    console.log(`- ${t.templateName}: ${t.metaStatus} | Category: ${t.metaCategory} (ExtID: ${t.externalId})`);
  });
  process.exit(0);
}

verify();
