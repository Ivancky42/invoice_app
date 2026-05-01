import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/** Neon: use DIRECT_DATABASE_URL (non‑pooled) for CLI if pooled URLs cause issues with `db push`. */
function datasourceUrl(): string {
  const direct = process.env.DIRECT_DATABASE_URL?.trim();
  if (direct) return direct;
  return env("DATABASE_URL");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: datasourceUrl(),
  },
});
