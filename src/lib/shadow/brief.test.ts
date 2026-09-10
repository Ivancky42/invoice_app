import { describe, expect, it } from "vitest";
import { paperPassBrief } from "@/lib/shadow/brief";

describe("paperPassBrief", () => {
  it("daily brief names both passes, book=PAPER, Pass A first, and one combined daily log", () => {
    const brief = paperPassBrief("daily");
    expect(brief).toContain("Pass A");
    expect(brief).toContain("Pass B");
    expect(brief).toContain("do this first");
    expect(brief).toContain('branch="LIVE"');
    expect(brief).toContain('branch="CANDIDATE"');
    expect(brief).toContain('book="PAPER"');
    expect(brief).toContain('get_prompt(name="daily", branch="LIVE", book="PAPER")');
    expect(brief).toContain("LIVE rules text only");
    expect(brief).toContain("Do not start Pass B");
    expect(brief).toMatch(/ONE `upsert_daily_log\(branch="CANDIDATE"/);
    expect(brief).toContain("Idle is a decision");
    expect(brief).toContain("Stock HQ connector");
    expect(brief).not.toContain("mcp:shadow");
    expect(brief).toContain("rejects this log if Pass A");
  });

  it("Pass A header is rules-only and does not describe Pass B", () => {
    const passA = paperPassBrief("daily", { passA: true });
    expect(passA).toContain("PAPER PASS A");
    expect(passA).toContain("LIVE ruleset");
    expect(passA).toContain("It is NOT Ivan's live-advice daily");
    expect(passA).toContain('branch="LIVE"');
    expect(passA).toContain('book="PAPER"');
    expect(passA).not.toContain("Pass B");
    expect(passA).not.toContain("mcp:shadow");
  });

  it("other prompt names get a short paper-pass header", () => {
    const shared = paperPassBrief("_shared");
    expect(shared).toContain("paper pass");
    expect(shared).toContain('book="PAPER"');
    expect(shared).not.toContain("mcp:shadow");
    expect(shared.split("\n").length).toBeLessThan(16);
    expect(paperPassBrief("weekly")).toContain("paper pass");
    expect(paperPassBrief("monthly")).toContain('get_prompt(name="daily"');
  });
});
