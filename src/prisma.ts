import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;

declare global {
  var __db: PrismaClient | undefined;
}

// This is needed because in development we don't want to restart
// the server with every change, but we are also not making a new connexion
// to the DB with every change, so we need to prevent this.
if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
  prisma.$connect();
} else {
  if (!global.__db) {
    global.__db = new PrismaClient();
    global.__db.$connect();
  }
  prisma = global.__db;
}

export { prisma };