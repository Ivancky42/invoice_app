import { describe, expect, it } from "vitest";
import { composePromptText, writingStyleBlock } from "@/lib/agent/styleBlock";

describe("writingStyleBlock", () => {
  it("titles the note and states the core style rules", () => {
    const block = writingStyleBlock();
    expect(block).toContain("# Writing for Ivan (server note, applies to every routine)");
    expect(block).toContain("Ivan is not a technical reader");
    expect(block).toContain("good analyst briefing a busy client");
    expect(block).toContain("still valid");
    expect(block).toContain("test-size position");
    expect(block).toContain("Nothing new.");
    expect(block).toContain("7-criteria scorecard");
    expect(block).toContain("reasonForDecision");
  });
});

describe("composePromptText", () => {
  it("starts with the style block for a non-shadow caller", () => {
    const markdown = "## 1. Daily routine\nDo the work.";
    const text = composePromptText(markdown, { shadow: false, name: "daily" });
    expect(text.startsWith(writingStyleBlock())).toBe(true);
    expect(text).toContain(markdown);
    expect(text).not.toContain("PAPER PASS");
  });

  it("puts the style block before the PAPER PASS brief for a shadow caller", () => {
    const markdown = "## 1. Daily routine\nDo the work.";
    const text = composePromptText(markdown, { shadow: true, name: "daily" });
    const style = writingStyleBlock();
    expect(text.startsWith(style)).toBe(true);
    const styleAt = 0;
    const briefAt = text.indexOf("# PAPER PASS");
    const bodyAt = text.indexOf(markdown);
    expect(briefAt).toBeGreaterThan(styleAt);
    expect(bodyAt).toBeGreaterThan(briefAt);
  });

  it("labels Pass A get_prompt as LIVE rules only, not the two-pass procedure", () => {
    const markdown = "## 1. Daily routine\nDo the work.";
    const text = composePromptText(markdown, { shadow: true, passA: true, name: "daily" });
    expect(text).toContain("PAPER PASS A");
    expect(text).toContain("It is NOT Ivan's live-advice daily");
    expect(text).not.toContain("### Pass B");
    expect(text).toContain(markdown);
  });
});
