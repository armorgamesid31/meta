const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.salonUser.findFirst({
    where: { email: 'owner@palmbeauty.com' }
  });
  console.log('USER_FOUND:', !!user);
  if (user) {
    console.log('USER_DATA:', JSON.stringify({ ...user, passwordHash: 'REDACTED' }, null, 2));
  } else {
    // List some users to see if we have ANY
    const someUsers = await prisma.salonUser.findMany({ take: 5 });
    console.log('SOME_USERS:', someUsers.map(u => u.email));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
