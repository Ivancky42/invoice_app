import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findSection, inventorySections } from "@/lib/evolution/sections";
import { sha256Hex } from "@/lib/rules/resolve";

describe("list_rule_sections inventory (disk _shared)", () => {
  it("exposes §4 sha that propose/gap-fix pin against", () => {
    const text = readFileSync(path.join(process.cwd(), "prompts", "_shared.md"), "utf8");
    const inv = inventorySections(text);
    const section4 = inv.find((s) => s.sectionId === "4");
    expect(section4?.heading).toMatch(/^## 4\./);
    expect(section4?.sha256).toBe(sha256Hex(findSection(text, "4")!.text));
    // Kernel fences live in neighbouring sections — §4 inventory must not look like a wipe.
    expect(inv.some((s) => s.sectionId === "3")).toBe(true);
    expect(inv.some((s) => s.sectionId === "5")).toBe(true);
  });
});
