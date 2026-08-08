import { promises as fs } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { kernelGate, mergeCandidateFiles, RULE_FILE_NAMES } from "@/lib/rules/resolve";

let disk: Record<string, string>;

beforeAll(async () => {
  const dir = path.join(process.cwd(), "prompts");
  const entries = await Promise.all(
    RULE_FILE_NAMES.map(
      async (name) => [name, await fs.readFile(path.join(dir, name), "utf8")] as const,
    ),
  );
  disk = Object.fromEntries(entries);
});

const clone = () => ({ ...disk });

describe("kernelGate", () => {
  it("passes the committed ruleset", () => {
    const gate = kernelGate(clone());
    expect(gate.ok).toBe(true);
    expect(gate.clauseIds).toEqual([]);
  });

  it("refuses a ruleset with a kernel section deleted, naming the clause", () => {
    const files = clone();
    files["_shared.md"] = files["_shared.md"]
      .replace("<!-- KERNEL:BEGIN id=execution-boundary v=1 -->\n", "")
      .replace("<!-- KERNEL:END id=execution-boundary -->\n", "");
    const gate = kernelGate(files);
    expect(gate.ok).toBe(false);
    expect(gate.clauseIds).toEqual(["execution-boundary"]);
    expect(gate.violations[0].code).toBe("MISSING_REGION");
  });

  it("refuses an edited kernel clause", () => {
    const files = clone();
    files["_shared.md"] = files["_shared.md"].replace(
      "- Never auto-add to Portfolio via any tool.",
      "- Sometimes auto-add to Portfolio via any tool.",
    );
    const gate = kernelGate(files);
    expect(gate.ok).toBe(false);
    expect(gate.clauseIds).toEqual(["execution-boundary"]);
  });

  it("refuses an empty ruleset (every clause missing)", () => {
    const gate = kernelGate({});
    expect(gate.ok).toBe(false);
    expect(gate.clauseIds.length).toBeGreaterThan(0);
  });
});

describe("mergeCandidateFiles", () => {
  it("fills files the candidate lacks from ACTIVE, not disk", () => {
    const merged = mergeCandidateFiles(
      { "_shared.md": "active shared", "daily.md": "active daily" },
      { "daily.md": "candidate daily" },
    );
    expect(merged).toEqual({
      "_shared.md": "active shared",
      "daily.md": "candidate daily",
    });
  });

  it("treats an empty candidate entry as absent", () => {
    const merged = mergeCandidateFiles({ "daily.md": "active daily" }, { "daily.md": "" });
    expect(merged["daily.md"]).toBe("active daily");
  });

  it("keeps a file only the candidate carries", () => {
    const merged = mergeCandidateFiles({}, { "weekly.md": "candidate weekly" });
    expect(merged).toEqual({ "weekly.md": "candidate weekly" });
  });
});
