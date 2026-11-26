import { describe, expect, it } from "vitest";
import { statusesForType, statusTypeError } from "@/lib/types";

describe("document status by type", () => {
  it("offers ACCEPTED / DECLINED on quotations only", () => {
    expect(statusesForType("QUOTATION")).toEqual(["DRAFT", "ISSUED", "ACCEPTED", "DECLINED", "PAID", "CANCELLED"]);
    expect(statusesForType("INVOICE")).toEqual(["DRAFT", "ISSUED", "PAID", "CANCELLED"]);
    expect(statusesForType("DELIVERY_ORDER")).toEqual(["DRAFT", "ISSUED", "PAID", "CANCELLED"]);
  });

  it("explains a mismatch", () => {
    expect(statusTypeError("QUOTATION", "ACCEPTED")).toBeNull();
    expect(statusTypeError("INVOICE", "PAID")).toBeNull();
    expect(statusTypeError("INVOICE", "ACCEPTED")).toBe("ACCEPTED is for quotations only (this is an invoice)");
  });
});
