import { describe, expect, it } from "vitest";
import { passAIncompleteMessage } from "@/lib/agent/writes";

describe("passAIncompleteMessage", () => {
  it("tells the agent to write LIVE PAPER reviews first", () => {
    const msg = passAIncompleteMessage("2026-09-10");
    expect(msg).toContain("Pass A is missing");
    expect(msg).toContain("2026-09-10");
    expect(msg).toContain('branch="LIVE"');
    expect(msg).toContain('book="PAPER"');
  });
});
