import { describe, expect, it } from "vitest";
import {
  assertDestructiveAllowed,
  assertWriteAllowed,
  inspectDatabaseUrl,
} from "./db-target-guard";

describe("inspectDatabaseUrl", () => {
  it("treats localhost DATABASE_URL as local", () => {
    const t = inspectDatabaseUrl("postgresql://u:p@localhost:5433/invoice_app");
    expect(t.isLocal).toBe(true);
    expect(t.requiresConfirm).toBe(false);
    expect(t.host).toBe("localhost");
    expect(t.database).toBe("invoice_app");
  });

  it("treats docker service names as local", () => {
    expect(inspectDatabaseUrl("postgresql://u:p@postgres:5432/db").requiresConfirm).toBe(false);
    expect(inspectDatabaseUrl("postgresql://u:p@db:5432/db").requiresConfirm).toBe(false);
  });

  it("treats Neon hosts as remote", () => {
    const t = inspectDatabaseUrl(
      "postgresql://u:p@ep-foo-bar-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
    );
    expect(t.isLocal).toBe(false);
    expect(t.requiresConfirm).toBe(true);
    expect(t.host).toContain("neon.tech");
    expect(t.database).toBe("neondb");
  });

  it("keys the write host off DATABASE_URL, not DIRECT", () => {
    const t = inspectDatabaseUrl(
      "postgresql://u:p@ep-prod.neon.tech/neondb",
      "postgresql://u:p@localhost:5433/invoice_app",
    );
    expect(t.host).toContain("neon.tech");
    expect(t.requiresConfirm).toBe(true);
  });

  it("requires confirm when DATABASE_URL is local but DIRECT is remote", () => {
    const t = inspectDatabaseUrl(
      "postgresql://u:p@localhost:5433/invoice_app",
      "postgresql://u:p@ep-prod.neon.tech/neondb",
    );
    expect(t.isLocal).toBe(true);
    expect(t.requiresConfirm).toBe(true);
    expect(t.hosts).toEqual(expect.arrayContaining(["localhost", "ep-prod.neon.tech"]));
  });

  it("throws when DATABASE_URL is missing even if DIRECT is set", () => {
    expect(() =>
      inspectDatabaseUrl("", "postgresql://u:p@localhost:5433/invoice_app"),
    ).toThrow(/DATABASE_URL is not set/);
  });

  it("throws when unset", () => {
    expect(() => inspectDatabaseUrl("", "")).toThrow(/not set/);
  });
});

describe("assertDestructiveAllowed", () => {
  const remote = "postgresql://u:p@ep-x.neon.tech/neondb";
  const local = "postgresql://u:p@localhost:5433/invoice_app";

  it("refuses remote wipe without --confirm-destructive", () => {
    const prevDb = process.env.DATABASE_URL;
    const prevDirect = process.env.DIRECT_DATABASE_URL;
    process.env.DATABASE_URL = remote;
    delete process.env.DIRECT_DATABASE_URL;
    try {
      expect(() => assertDestructiveAllowed("wipe", ["node", "script.ts"])).toThrow(/Refusing/);
    } finally {
      process.env.DATABASE_URL = prevDb;
      process.env.DIRECT_DATABASE_URL = prevDirect;
    }
  });

  it("refuses when DATABASE_URL is prod even if DIRECT is local", () => {
    const prevDb = process.env.DATABASE_URL;
    const prevDirect = process.env.DIRECT_DATABASE_URL;
    process.env.DATABASE_URL = remote;
    process.env.DIRECT_DATABASE_URL = local;
    try {
      expect(() => assertDestructiveAllowed("wipe", ["node", "script.ts"])).toThrow(/Refusing/);
    } finally {
      process.env.DATABASE_URL = prevDb;
      process.env.DIRECT_DATABASE_URL = prevDirect;
    }
  });

  it("allows remote wipe with --confirm-destructive", () => {
    const prevDb = process.env.DATABASE_URL;
    const prevDirect = process.env.DIRECT_DATABASE_URL;
    process.env.DATABASE_URL = remote;
    delete process.env.DIRECT_DATABASE_URL;
    try {
      const t = assertDestructiveAllowed("wipe", [
        "node",
        "script.ts",
        "--confirm-destructive",
      ]);
      expect(t.requiresConfirm).toBe(true);
    } finally {
      process.env.DATABASE_URL = prevDb;
      process.env.DIRECT_DATABASE_URL = prevDirect;
    }
  });

  it("allows local wipe without confirm", () => {
    const prevDb = process.env.DATABASE_URL;
    const prevDirect = process.env.DIRECT_DATABASE_URL;
    process.env.DATABASE_URL = local;
    delete process.env.DIRECT_DATABASE_URL;
    try {
      const t = assertDestructiveAllowed("wipe", ["node", "script.ts"]);
      expect(t.requiresConfirm).toBe(false);
    } finally {
      process.env.DATABASE_URL = prevDb;
      process.env.DIRECT_DATABASE_URL = prevDirect;
    }
  });
});

describe("assertWriteAllowed", () => {
  const remote = "postgresql://u:p@ep-x.neon.tech/neondb";

  it("refuses remote write without confirm", () => {
    const prevDb = process.env.DATABASE_URL;
    const prevDirect = process.env.DIRECT_DATABASE_URL;
    process.env.DATABASE_URL = remote;
    delete process.env.DIRECT_DATABASE_URL;
    try {
      expect(() => assertWriteAllowed("patch", ["node", "script.ts"])).toThrow(/Refusing/);
    } finally {
      process.env.DATABASE_URL = prevDb;
      process.env.DIRECT_DATABASE_URL = prevDirect;
    }
  });

  it("allows remote write with --confirm-write", () => {
    const prevDb = process.env.DATABASE_URL;
    const prevDirect = process.env.DIRECT_DATABASE_URL;
    process.env.DATABASE_URL = remote;
    delete process.env.DIRECT_DATABASE_URL;
    try {
      const t = assertWriteAllowed("patch", ["node", "script.ts", "--confirm-write"]);
      expect(t.host).toContain("neon.tech");
    } finally {
      process.env.DATABASE_URL = prevDb;
      process.env.DIRECT_DATABASE_URL = prevDirect;
    }
  });
});
