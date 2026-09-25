import { describe, expect, it } from "vitest";
import { activeVersionAt, branchVersionAt, type TimelineVersion } from "./ruleVersionTimeline";

const d = (iso: string) => new Date(iso);

// Mirrors production RuleVersion rows as of 2026-09-25.
const versions: TimelineVersion[] = [
  { id: 1, lane: null, createdAt: d("2026-08-08T08:00:52Z"), activatedAt: d("2026-08-08T08:00:52Z"), retiredAt: d("2026-08-09T13:58:48.351Z") },
  { id: 5, lane: null, createdAt: d("2026-08-09T13:58:49.561Z"), activatedAt: d("2026-08-09T13:58:49.554Z"), retiredAt: d("2026-09-04T13:25:47.396Z") },
  { id: 6, lane: "SLOW", createdAt: d("2026-08-17T00:02:20.536Z"), activatedAt: null, retiredAt: d("2026-09-04T13:25:47.396Z") },
  { id: 7, lane: null, createdAt: d("2026-09-04T13:25:47.498Z"), activatedAt: d("2026-09-04T13:25:47.396Z"), retiredAt: null },
  { id: 8, lane: "SLOW", createdAt: d("2026-09-04T13:25:47.587Z"), activatedAt: null, retiredAt: null },
];

describe("ruleVersionTimeline", () => {
  it("returns null before any ruleset existed", () => {
    expect(activeVersionAt(versions, d("2026-08-06T00:00:00Z"))).toBeNull();
  });

  it("resolves LIVE to the ACTIVE version at the time", () => {
    expect(branchVersionAt(versions, "LIVE", d("2026-08-20T00:00:00Z"))).toBe(5);
    expect(branchVersionAt(versions, "LIVE", d("2026-09-10T00:00:00Z"))).toBe(7);
  });

  it("resolves an idle CANDIDATE book to ACTIVE (LUNR, 2026-08-09 after the gap-fixes)", () => {
    expect(branchVersionAt(versions, "CANDIDATE", d("2026-08-09T20:00:00Z"))).toBe(5);
  });

  it("resolves CANDIDATE to the in-flight challenger", () => {
    expect(branchVersionAt(versions, "CANDIDATE", d("2026-09-02T09:00:00Z"))).toBe(6);
    expect(branchVersionAt(versions, "CANDIDATE", d("2026-09-10T09:00:00Z"))).toBe(8);
  });

  it("never attributes a decision to a challenger that did not exist yet", () => {
    expect(branchVersionAt(versions, "CANDIDATE", d("2026-08-31T09:00:00Z"))).toBe(6);
    expect(branchVersionAt(versions, "CANDIDATE", d("2026-08-31T09:00:00Z"))).not.toBe(8);
  });
});
