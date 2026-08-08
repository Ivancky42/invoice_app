import { describe, expect, it } from "vitest";
import { filterDecisionsAfterReset } from "@/lib/shadow/tenure";

const SESSIONS = ["2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-03"];

function row(decisionDate: string | null, createdAt = "2026-08-04T15:00:00.000Z") {
  return {
    decisionDate: decisionDate ? new Date(`${decisionDate}T12:00:00.000Z`) : null,
    createdAt: new Date(createdAt),
  };
}

describe("filterDecisionsAfterReset", () => {
  it("passes through when resetAt is absent", () => {
    const rows = [row("2026-05-01")];
    expect(filterDecisionsAfterReset(SESSIONS, rows, null)).toEqual(rows);
  });

  it("drops decisions whose calendar day is before the reset Eastern day", () => {
    const resetAt = new Date("2026-07-31T14:00:00.000-04:00");
    const kept = row("2026-07-31");
    const dropped = row("2026-07-28");
    expect(filterDecisionsAfterReset(SESSIONS, [dropped, kept], resetAt)).toEqual([kept]);
  });

  it("does not slide the floor back when reset falls on a weekend", () => {
    // Saturday Eastern — must not keep Friday decisionDates via session-on-or-before.
    const resetAt = new Date("2026-08-01T12:00:00.000-04:00");
    const friday = row("2026-07-31");
    const monday = row("2026-08-03");
    expect(filterDecisionsAfterReset(SESSIONS, [friday, monday], resetAt)).toEqual([monday]);
  });

  it("keeps null-decisionDate rows dated by Eastern createdAt on/after reset", () => {
    const resetAt = new Date("2026-07-31T14:00:00.000-04:00");
    const kept = row(null, "2026-07-31T20:00:00.000Z");
    const dropped = row(null, "2026-07-28T20:00:00.000Z");
    expect(filterDecisionsAfterReset(SESSIONS, [dropped, kept], resetAt)).toEqual([kept]);
  });
});
