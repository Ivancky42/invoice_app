import "dotenv/config";
import { defineConfig, env } from "prisma/config";
import { directDatabaseUrl } from "./scripts/lib/directDatabaseUrl";

// Migrations run over a direct (non-pooled) connection — see directDatabaseUrl.

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: directDatabaseUrl(process.env, () => env("DATABASE_URL")),
  },
});
