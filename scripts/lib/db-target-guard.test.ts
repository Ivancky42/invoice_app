import { describe, expect, it } from "vitest";
import {
  assertDestructiveAllowed,
  assertWriteAllowed,
  inspectDatabaseUrl,
} from "../../scripts/lib/db-target-guard";

describe("inspectDatabaseUrl", () => {
  it("treats localhost as local", () => {
    const t = inspectDatabaseUrl("postgresql://u:p@localhost:5433/invoice_app");
    expect(t.isLocal).toBe(true);
    expect(t.host).toBe("localhost");
    expect(t.database).toBe("invoice_app");
  });

  it("treats docker service names as local", () => {
    expect(inspectDatabaseUrl("postgresql://u:p@postgres:5432/db").isLocal).toBe(true);
    expect(inspectDatabaseUrl("postgresql://u:p@db:5432/db").isLocal).toBe(true);
  });

  it("treats Neon hosts as remote", () => {
    const t = inspectDatabaseUrl(
      "postgresql://u:p@ep-foo-bar-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
    );
    expect(t.isLocal).toBe(false);
    expect(t.host).toContain("neon.tech");
    expect(t.database).toBe("neondb");
  });

  it("throws when unset", () => {
    expect(() => inspectDatabaseUrl("")).toThrow(/not set/);
  });
});

describe("assertDestructiveAllowed", () => {
  const remote = "postgresql://u:p@ep-x.neon.tech/neondb";
  const local = "postgresql://u:p@localhost:5433/invoice_app";

  it("refuses remote wipe without --confirm-destructive", () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = remote;
    try {
      expect(() => assertDestructiveAllowed("wipe", ["node", "script.ts"])).toThrow(
        /Refusing/,
      );
    } finally {
      process.env.DATABASE_URL = prev;
    }
  });

  it("allows remote wipe with --confirm-destructive", () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = remote;
    try {
      const t = assertDestructiveAllowed("wipe", [
        "node",
        "script.ts",
        "--confirm-destructive",
      ]);
      expect(t.isLocal).toBe(false);
    } finally {
      process.env.DATABASE_URL = prev;
    }
  });

  it("allows local wipe without confirm", () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = local;
    try {
      const t = assertDestructiveAllowed("wipe", ["node", "script.ts"]);
      expect(t.isLocal).toBe(true);
    } finally {
      process.env.DATABASE_URL = prev;
    }
  });
});

describe("assertWriteAllowed", () => {
  const remote = "postgresql://u:p@ep-x.neon.tech/neondb";

  it("refuses remote write without confirm", () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = remote;
    try {
      expect(() => assertWriteAllowed("patch", ["node", "script.ts"])).toThrow(/Refusing/);
    } finally {
      process.env.DATABASE_URL = prev;
    }
  });

  it("allows remote write with --confirm-write", () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = remote;
    try {
      const t = assertWriteAllowed("patch", ["node", "script.ts", "--confirm-write"]);
      expect(t.host).toContain("neon.tech");
    } finally {
      process.env.DATABASE_URL = prev;
    }
  });
});
