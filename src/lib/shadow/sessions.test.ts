import { describe, expect, it } from "vitest";
import {
  decisionSessionFromEasternDate,
  easternDateOf,
  isSessionIn,
  latestSessionOnOrBeforeIn,
  nextSessionAfterIn,
  previousSessionBeforeIn,
  sessionDatesFromRows,
  sessionOffsetIn,
} from "@/lib/shadow/sessions";

const bar = (ticker: string, day: string) => ({
  ticker,
  date: new Date(`${day}T00:00:00.000Z`),
});

describe("sessionDatesFromRows", () => {
  it("counts a date as a session once two anchors have a bar", () => {
    const rows = [bar("SPY", "2026-08-03"), bar("QQQ", "2026-08-03")];
    expect(sessionDatesFromRows(rows)).toEqual(["2026-08-03"]);
  });

  it("refuses a date backed by a single anchor (one flaky provider row)", () => {
    expect(sessionDatesFromRows([bar("SPY", "2026-08-03")])).toEqual([]);
  });

  it("does not let one anchor's duplicate rows reach quorum", () => {
    const rows = [bar("SPY", "2026-08-03"), bar("spy", "2026-08-03")];
    expect(sessionDatesFromRows(rows)).toEqual([]);
  });

  it("ignores non-anchor tickers entirely", () => {
    const rows = [bar("NVDA", "2026-08-03"), bar("TSLA", "2026-08-03"), bar("SPY", "2026-08-03")];
    expect(sessionDatesFromRows(rows)).toEqual([]);
  });

  it("returns sessions ascending and de-duplicated", () => {
    const rows = [
      bar("SPY", "2026-08-04"),
      bar("QQQ", "2026-08-04"),
      bar("AAPL", "2026-08-03"),
      bar("MSFT", "2026-08-03"),
    ];
    expect(sessionDatesFromRows(rows)).toEqual(["2026-08-03", "2026-08-04"]);
  });
});

// Mon 3rd … Fri 7th, then Mon 10th — a weekend gap, as the real calendar has.
const SESSIONS = [
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-10",
];

describe("calendar lookups", () => {
  it("isSessionIn is false on a weekend date", () => {
    expect(isSessionIn(SESSIONS, "2026-08-08")).toBe(false);
    expect(isSessionIn(SESSIONS, "2026-08-07")).toBe(true);
  });

  it("latestSessionOnOrBefore rolls a weekend back to Friday", () => {
    expect(latestSessionOnOrBeforeIn(SESSIONS, "2026-08-09")).toBe("2026-08-07");
    expect(latestSessionOnOrBeforeIn(SESSIONS, "2026-08-05")).toBe("2026-08-05");
    expect(latestSessionOnOrBeforeIn(SESSIONS, "2026-08-01")).toBeNull();
  });

  it("nextSessionAfter jumps the weekend and returns null past the end", () => {
    expect(nextSessionAfterIn(SESSIONS, "2026-08-07")).toBe("2026-08-10");
    expect(nextSessionAfterIn(SESSIONS, "2026-08-08")).toBe("2026-08-10");
    expect(nextSessionAfterIn(SESSIONS, "2026-08-10")).toBeNull();
  });

  it("previousSessionBefore is strictly before the day (no same-session lookahead)", () => {
    expect(previousSessionBeforeIn(SESSIONS, "2026-08-05")).toBe("2026-08-04");
    // A weekend date has no session of its own — Friday is already strictly before it.
    expect(previousSessionBeforeIn(SESSIONS, "2026-08-09")).toBe("2026-08-07");
    expect(previousSessionBeforeIn(SESSIONS, "2026-08-03")).toBeNull();
    expect(previousSessionBeforeIn(SESSIONS, "2026-08-01")).toBeNull();
  });

  it("sessionOffset counts sessions, not calendar days", () => {
    expect(sessionOffsetIn(SESSIONS, "2026-08-03", 5)).toBe("2026-08-10");
    expect(sessionOffsetIn(SESSIONS, "2026-08-03", 6)).toBeNull();
    // Anchoring on a non-session is refused rather than silently rolled.
    expect(sessionOffsetIn(SESSIONS, "2026-08-08", 1)).toBeNull();
  });
});

describe("decisionSessionFor date math", () => {
  it("credits a 20:00 ET write to that day's session, not the next UTC day's", () => {
    // 2026-08-05 20:00 ET = 2026-08-06 00:00 UTC.
    const createdAt = new Date("2026-08-06T00:00:00.000Z");
    expect(easternDateOf(createdAt)).toBe("2026-08-05");
    expect(decisionSessionFromEasternDate(SESSIONS, easternDateOf(createdAt))).toBe(
      "2026-08-05",
    );
  });

  it("uses the Eastern calendar date's own session when it is a trading day", () => {
    // 2026-08-06 06:00 ET. Routines run after the close, so the 6th is the intended
    // session; this is the documented rule, not an accident of the lookup.
    const createdAt = new Date("2026-08-06T10:00:00.000Z");
    expect(easternDateOf(createdAt)).toBe("2026-08-06");
    expect(decisionSessionFromEasternDate(SESSIONS, easternDateOf(createdAt))).toBe(
      "2026-08-06",
    );
  });

  it("a weekend write falls back to Friday's session", () => {
    const createdAt = new Date("2026-08-09T16:00:00.000Z");
    expect(decisionSessionFromEasternDate(SESSIONS, easternDateOf(createdAt))).toBe(
      "2026-08-07",
    );
  });

  it("returns null before any session exists", () => {
    const createdAt = new Date("2026-07-01T16:00:00.000Z");
    expect(decisionSessionFromEasternDate(SESSIONS, easternDateOf(createdAt))).toBeNull();
  });
});
