import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { normalizePgConnectionString } from "@/lib/pg-connection-string";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const pool =
    globalForPrisma.pgPool ??
    new Pool({
      connectionString: normalizePgConnectionString(url),
      // Serverless: keep small; avoid waiting forever on a stuck/cold Neon connect.
      max: 4,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
  globalForPrisma.pgPool = pool;

  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

function getClient(): PrismaClient {
  const cached = globalForPrisma.prisma;
  // Dev HMR can keep an old PrismaClient instance after `prisma generate`.
  if (cached?.clientProfile) return cached;

  const client = createClient();
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = client;
  return client;
}

export const prisma = getClient();
