import { PrismaPg } from "@prisma/adapter-pg";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { normalizePgConnectionString } from "@/lib/pg-connection-string";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

function createPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const pool = new Pool({
    connectionString: normalizePgConnectionString(url),
    // Serverless: keep small; avoid waiting forever on a stuck/cold Neon connect.
    max: 4,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });

  // Fluid Compute: release idle clients before the isolate suspends.
  attachDatabasePool(pool);
  return pool;
}

function createClient(): PrismaClient {
  const pool = globalForPrisma.pgPool ?? createPool();
  globalForPrisma.pgPool = pool;

  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

/** True when cached client matches the generated schema (survives `prisma generate` + HMR). */
function isCurrentClient(client: PrismaClient | undefined): client is PrismaClient {
  if (!client) return false;
  // Probe the newest models — an older singleton may still expose older delegates.
  return (
    typeof (client as { decisionReview?: unknown }).decisionReview !== "undefined" &&
    typeof (client as { contentPage?: unknown }).contentPage !== "undefined"
  );
}

function getClient(): PrismaClient {
  const cached = globalForPrisma.prisma;
  if (isCurrentClient(cached)) return cached;

  const client = createClient();
  globalForPrisma.prisma = client;
  return client;
}

/**
 * Lazy proxy so module reloads / HMR never freeze a pre-generate PrismaClient
 * on `export const prisma = getClient()`.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
