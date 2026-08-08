import { describe, expect, it } from "vitest";
import { shouldPreserveBookFields } from "./snapshot";

describe("shouldPreserveBookFields", () => {
  it("preserves existing historical rows", () => {
    expect(shouldPreserveBookFields("2026-07-15", "2026-08-07", true)).toBe(true);
  });

  it("does not preserve the calendar tip (daily cron path)", () => {
    expect(shouldPreserveBookFields("2026-08-07", "2026-08-07", true)).toBe(false);
  });

  it("does not preserve creates (replay-after-wipe path)", () => {
    expect(shouldPreserveBookFields("2026-07-15", "2026-08-07", false)).toBe(false);
  });
});
