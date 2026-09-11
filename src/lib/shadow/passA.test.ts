import { describe, expect, it } from "vitest";
import { paperPassAYmd, passAIncompleteMessage } from "@/lib/shadow/passA";

describe("passAIncompleteMessage", () => {
  it("tells the agent to write LIVE PAPER reviews first, then retry the log", () => {
    const msg = passAIncompleteMessage("2026-09-11", "log");
    expect(msg).toContain("Pass A is missing");
    expect(msg).toContain("2026-09-11");
    expect(msg).toContain('branch="LIVE"');
    expect(msg).toContain('book="PAPER"');
    expect(msg).toContain("retry this log");
  });

  it("tells the agent to retry the CANDIDATE review after Pass A", () => {
    const msg = passAIncompleteMessage("2026-09-11", "decision");
    expect(msg).toContain("Pass A is missing");
    expect(msg).toContain("retry this CANDIDATE review");
    expect(msg).not.toContain("retry this log");
  });
});

describe("paperPassAYmd", () => {
  it("uses the Asia/Kuala_Lumpur calendar date", () => {
    // 2026-09-11 01:12 UTC = 09:12 MYT same calendar day.
    expect(paperPassAYmd(new Date("2026-09-11T01:12:00.000Z"))).toBe("2026-09-11");
    // 2026-09-10 16:30 UTC = 2026-09-11 00:30 MYT.
    expect(paperPassAYmd(new Date("2026-09-10T16:30:00.000Z"))).toBe("2026-09-11");
  });
});
