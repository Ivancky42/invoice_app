import { describe, expect, it } from "vitest";
import { directDatabaseUrl, unpooledNeonUrl } from "./directDatabaseUrl";

const POOLED = "postgresql://u:p@ep-cool-river-123-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true";

describe("directDatabaseUrl (Prisma CLI must not go through PgBouncer)", () => {
  it("prefers an explicit direct URL, then Neon's unpooled variables", () => {
    expect(directDatabaseUrl({ DIRECT_DATABASE_URL: "postgres://direct" }, () => POOLED)).toBe("postgres://direct");
    expect(directDatabaseUrl({ DATABASE_URL_UNPOOLED: "postgres://unpooled" }, () => POOLED)).toBe("postgres://unpooled");
    expect(directDatabaseUrl({ POSTGRES_URL_NON_POOLING: "postgres://np" }, () => POOLED)).toBe("postgres://np");
  });

  it("otherwise strips Neon's -pooler host suffix from DATABASE_URL", () => {
    expect(directDatabaseUrl({}, () => POOLED)).toBe(
      "postgresql://u:p@ep-cool-river-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
    );
  });

  it("leaves non-Neon and already-direct URLs alone", () => {
    expect(unpooledNeonUrl("postgresql://invoice:invoice@localhost:5433/invoice_app?schema=public")).toBe(
      "postgresql://invoice:invoice@localhost:5433/invoice_app?schema=public",
    );
    const direct = "postgresql://u:p@ep-cool-river-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
    expect(unpooledNeonUrl(direct)).toBe(direct);
    expect(unpooledNeonUrl("not a url")).toBe("not a url");
  });
});
