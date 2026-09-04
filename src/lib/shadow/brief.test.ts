import { describe, expect, it } from "vitest";
import { paperPassBrief } from "@/lib/shadow/brief";

describe("paperPassBrief", () => {
  it("daily brief names both passes, book=PAPER, and one combined daily log", () => {
    const brief = paperPassBrief("daily");
    expect(brief).toContain("Pass A");
    expect(brief).toContain("Pass B");
    expect(brief).toContain('branch="LIVE"');
    expect(brief).toContain('branch="CANDIDATE"');
    expect(brief).toContain('book="PAPER"');
    expect(brief).toMatch(/ONE `upsert_daily_log\(branch="CANDIDATE"/);
    expect(brief).toContain("Idle is a decision");
  });

  it("other prompt names get a short paper-pass header", () => {
    const shared = paperPassBrief("_shared");
    expect(shared).toContain("paper passes only");
    expect(shared).toContain('book="PAPER"');
    expect(shared.split("\n").length).toBeLessThan(16);
    expect(paperPassBrief("weekly")).toContain("paper passes only");
    expect(paperPassBrief("monthly")).toContain("get_prompt(name=\"daily\"");
  });
});
