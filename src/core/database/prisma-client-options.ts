import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Prisma } from '@prisma/client';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to create the Prisma client');
}

export const prismaClientOptions = {
  adapter: new PrismaPg({ connectionString }),
} satisfies Prisma.PrismaClientOptions;
