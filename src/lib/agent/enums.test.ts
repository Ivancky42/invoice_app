import { describe, expect, it } from "vitest";
import { listStockEnums } from "@/lib/agent/enums";

describe("listStockEnums", () => {
  it("includes PositionAction values", () => {
    const enums = listStockEnums();
    expect(enums.PositionAction).toContain("HOLD");
  });
});
