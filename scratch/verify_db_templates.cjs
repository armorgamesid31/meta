const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verify() {
  const salonId = 7;
  const templates = await prisma.salonMessageTemplate.findMany({
    where: { salonId }
  });
  
  console.log(`Salon ${salonId} has ${templates.length} templates in DB.`);
  templates.forEach(t => {
    console.log(`- ${t.templateName}: ${t.metaStatus} (ExtID: ${t.externalId})`);
  });
  process.exit(0);
}

verify();
