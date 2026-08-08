import { describe, expect, it } from "vitest";
import {
  calendarDayDistance,
  dedupeDecisionsForShadow,
  isSeedIdempotencyKey,
} from "@/lib/shadow/dedupe";

function row(
  partial: Partial<{
    id: string;
    ticker: string;
    decisionType: string;
    decisionDate: Date | null;
    notionId: string | null;
    idempotencyKey: string | null;
  }>,
) {
  return {
    id: partial.id ?? "id",
    ticker: partial.ticker ?? "ISRG",
    decisionType: partial.decisionType ?? "ADD",
    decisionDate: partial.decisionDate ?? new Date("2026-07-27T12:00:00.000Z"),
    notionId: partial.notionId ?? null,
    idempotencyKey: partial.idempotencyKey ?? null,
  };
}

describe("isSeedIdempotencyKey", () => {
  it("detects bare and CANDIDATE-prefixed seed keys", () => {
    expect(isSeedIdempotencyKey("seed-dr-ISRG-ADD-20260727")).toBe(true);
    expect(isSeedIdempotencyKey("CANDIDATE:seed-dr-ISRG-ADD-20260727")).toBe(true);
    expect(isSeedIdempotencyKey("dr-ISRG-ADD-20260727")).toBe(false);
    expect(isSeedIdempotencyKey(null)).toBe(false);
  });
});

describe("calendarDayDistance", () => {
  it("returns absolute day distance", () => {
    expect(calendarDayDistance("2026-07-27", "2026-07-28")).toBe(1);
    expect(calendarDayDistance("2026-07-28", "2026-07-27")).toBe(1);
    expect(calendarDayDistance("2026-07-27", "2026-07-27")).toBe(0);
    expect(calendarDayDistance(null, "2026-07-27")).toBeNull();
  });
});

describe("dedupeDecisionsForShadow", () => {
  it("keeps Notion over a seed near-twin (±1 day, same ticker+type)", () => {
    const seed = row({
      id: "seed",
      idempotencyKey: "seed-dr-ISRG-ADD-20260727",
      decisionDate: new Date("2026-07-27T12:00:00.000Z"),
    });
    const notion = row({
      id: "notion",
      notionId: "abc-notion",
      decisionDate: new Date("2026-07-28T00:00:00.000Z"),
    });
    expect(dedupeDecisionsForShadow([seed, notion]).map((r) => r.id)).toEqual(["notion"]);
    expect(dedupeDecisionsForShadow([notion, seed]).map((r) => r.id)).toEqual(["notion"]);
  });

  it("keeps a seed when no Notion twin is nearby", () => {
    const seed = row({
      id: "seed",
      idempotencyKey: "seed-dr-OKLO-EXIT-20260718",
      ticker: "OKLO",
      decisionType: "EXIT",
      decisionDate: new Date("2026-07-18T12:00:00.000Z"),
    });
    expect(dedupeDecisionsForShadow([seed]).map((r) => r.id)).toEqual(["seed"]);
  });

  it("drops later rows that share a notionId", () => {
    const a = row({ id: "a", notionId: "same", decisionDate: new Date("2026-05-28T00:00:00Z") });
    const b = row({ id: "b", notionId: "same", decisionDate: new Date("2026-06-02T00:00:00Z") });
    expect(dedupeDecisionsForShadow([a, b]).map((r) => r.id)).toEqual(["a"]);
  });

  it("keeps distinct Notion DRs of the same ticker+type on different days", () => {
    const a = row({
      id: "a",
      notionId: "n1",
      decisionType: "DO_NOT_AVERAGE_DOWN",
      decisionDate: new Date("2026-05-28T00:00:00Z"),
    });
    const b = row({
      id: "b",
      notionId: "n2",
      decisionType: "DO_NOT_AVERAGE_DOWN",
      decisionDate: new Date("2026-06-02T00:00:00Z"),
    });
    expect(dedupeDecisionsForShadow([a, b]).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
