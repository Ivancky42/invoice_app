import { describe, expect, it } from "vitest";
import { proposeHunkSchema, proposeRuleChangeInputSchema } from "@/lib/agent/schemas";

const sha = "a".repeat(64);

describe("propose hunk schema", () => {
  it("requires sectionId and expectedSectionSha", () => {
    const missing = proposeHunkSchema.safeParse({
      file: "_shared",
      newText: "## 4. Adaptive\nstaleness gate",
    });
    expect(missing.success).toBe(false);

    const ok = proposeHunkSchema.safeParse({
      file: "_shared",
      sectionId: "4",
      expectedSectionSha: sha,
      newText: "## 4. Adaptive\nstaleness gate",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a whole-file-style hunk missing section scope at the propose envelope", () => {
    const parsed = proposeRuleChangeInputSchema.safeParse({
      hunks: [{ file: "_shared.md", newText: "fragment without fences" }],
      changeSummary: "x".repeat(40),
      reasoningPattern: "stale-attribution-input-gate",
      successMetric: "fitness z > 0 over 30 sessions",
      counterCase: "x".repeat(40),
      evidenceDecisionIds: ["a", "b", "c"],
    });
    expect(parsed.success).toBe(false);
  });
});
