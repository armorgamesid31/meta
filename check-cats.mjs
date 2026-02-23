import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const cats = await prisma.service.findMany({ select: { category: true }, distinct: ['category'] })
  console.log(JSON.stringify(cats))
}
main()
