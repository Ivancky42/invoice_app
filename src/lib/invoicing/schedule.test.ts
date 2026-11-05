import { describe, expect, it } from "vitest";
import {
  effectiveDueDate,
  formatDateOnly,
  isBeyondEnd,
  netDaysFromTerms,
  nextOccurrenceAfter,
  nextPaidAt,
  nextOccurrenceOnOrAfter,
  parseDateOnly,
  periodLabel,
  previewOccurrences,
  renderTemplate,
  templatizePeriod,
  todayInTimeZone,
  type ScheduleShape,
} from "@/lib/invoicing/schedule";

const d = parseDateOnly;
const fmt = (xs: Date[]) => xs.map(formatDateOnly);

function monthly(start: string, extra: Partial<ScheduleShape> = {}): ScheduleShape {
  return { frequency: "MONTHLY", interval: 1, dayOfMonth: null, startDate: d(start), ...extra };
}

describe("parseDateOnly", () => {
  it("accepts dates and ISO datetimes", () => {
    expect(formatDateOnly(d("2026-02-28"))).toBe("2026-02-28");
    expect(formatDateOnly(d("2026-02-28T15:00:00Z"))).toBe("2026-02-28");
  });
  it("rejects impossible dates", () => {
    expect(() => d("2026-02-30")).toThrow();
    expect(() => d("nope")).toThrow();
  });
});

describe("todayInTimeZone", () => {
  it("uses the business calendar, not UTC", () => {
    // 22:00 UTC on 4 Nov is 06:00 on 5 Nov in Kuala Lumpur — when the cron fires.
    const now = new Date("2026-11-04T22:00:00Z");
    expect(formatDateOnly(todayInTimeZone(now, "Asia/Kuala_Lumpur"))).toBe("2026-11-05");
    expect(formatDateOnly(todayInTimeZone(now, "UTC"))).toBe("2026-11-04");
  });
});

describe("monthly schedules", () => {
  it("bills on the start date's day each month", () => {
    const s = monthly("2026-11-05", { maxOccurrences: 6 });
    expect(fmt(previewOccurrences(s, s.startDate, 0, 12))).toEqual([
      "2026-11-05",
      "2026-12-05",
      "2027-01-05",
      "2027-02-05",
      "2027-03-05",
      "2027-04-05",
    ]);
  });

  it("clamps the 31st to month end without drifting", () => {
    const s = monthly("2027-01-31");
    expect(fmt(previewOccurrences(s, s.startDate, 0, 4))).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("uses dayOfMonth and skips a slot that falls before the start", () => {
    const s = monthly("2026-11-20", { dayOfMonth: 1 });
    expect(formatDateOnly(nextOccurrenceOnOrAfter(s, s.startDate))).toBe("2026-12-01");
    const later = monthly("2026-11-02", { dayOfMonth: 15 });
    expect(formatDateOnly(nextOccurrenceOnOrAfter(later, later.startDate))).toBe("2026-11-15");
  });

  it("finds the next slot strictly after a date, across years", () => {
    const s = monthly("2026-11-05");
    expect(formatDateOnly(nextOccurrenceAfter(s, d("2026-11-05")))).toBe("2026-12-05");
    expect(formatDateOnly(nextOccurrenceAfter(s, d("2028-06-04")))).toBe("2028-06-05");
    expect(formatDateOnly(nextOccurrenceAfter(s, d("2028-06-05")))).toBe("2028-07-05");
  });

  it("supports every-N months, quarterly and yearly", () => {
    expect(fmt(previewOccurrences(monthly("2026-01-10", { interval: 2 }), d("2026-01-10"), 0, 3))).toEqual([
      "2026-01-10",
      "2026-03-10",
      "2026-05-10",
    ]);
    const q: ScheduleShape = { frequency: "QUARTERLY", interval: 1, dayOfMonth: 31, startDate: d("2026-01-31") };
    expect(fmt(previewOccurrences(q, q.startDate, 0, 3))).toEqual(["2026-01-31", "2026-04-30", "2026-07-31"]);
    const y: ScheduleShape = { frequency: "YEARLY", interval: 1, dayOfMonth: null, startDate: d("2028-02-29") };
    expect(fmt(previewOccurrences(y, y.startDate, 0, 2))).toEqual(["2028-02-29", "2029-02-28"]);
  });
});

describe("weekly schedules", () => {
  it("steps by 7 × interval days", () => {
    const s: ScheduleShape = { frequency: "WEEKLY", interval: 2, dayOfMonth: null, startDate: d("2026-11-02") };
    expect(fmt(previewOccurrences(s, d("2026-11-03"), 0, 3))).toEqual(["2026-11-16", "2026-11-30", "2026-12-14"]);
  });
});

describe("end conditions", () => {
  it("stops at maxOccurrences, counting invoices already made", () => {
    const s = monthly("2026-11-05", { maxOccurrences: 6 });
    expect(previewOccurrences(s, d("2027-02-05"), 3, 10)).toHaveLength(3);
    expect(isBeyondEnd(s, d("2027-05-05"), 6)).toBe(true);
    expect(isBeyondEnd(s, d("2027-04-05"), 5)).toBe(false);
  });

  it("stops after endDate (inclusive)", () => {
    const s = monthly("2026-11-05", { endDate: d("2027-01-05") });
    expect(fmt(previewOccurrences(s, s.startDate, 0, 10))).toEqual(["2026-11-05", "2026-12-05", "2027-01-05"]);
  });

  it("indefinite schedules keep going", () => {
    expect(previewOccurrences(monthly("2026-11-05"), d("2026-11-05"), 500, 24)).toHaveLength(24);
  });
});

describe("templates", () => {
  it("fills placeholders", () => {
    const text = renderTemplate("Retainer {{period}} ({{n}}/{{of}}) {{ unknown }}", {
      frequency: "MONTHLY",
      interval: 1,
      date: d("2026-11-05"),
      n: 1,
      of: 6,
    });
    expect(text).toBe("Retainer November 2026 (1/6) {{ unknown }}");
  });

  it("labels multi-month and weekly periods", () => {
    expect(periodLabel("QUARTERLY", 1, d("2026-11-05"))).toBe("Nov 2026 – Jan 2027");
    expect(periodLabel("YEARLY", 1, d("2026-11-05"))).toBe("2026");
    expect(periodLabel("WEEKLY", 1, d("2026-11-05"))).toBe("week of 5 Nov 2026");
  });
});

describe("templatizePeriod", () => {
  it("turns the source invoice's own month into {{period}}", () => {
    const oct = d("2026-10-05");
    expect(templatizePeriod("Website retainer October 2026", oct)).toBe("Website retainer {{period}}");
    expect(templatizePeriod("Retainer (Oct. 2026)", oct)).toBe("Retainer ({{period}})");
    expect(templatizePeriod("Retainer September 2026", oct)).toBe("Retainer September 2026");
    expect(templatizePeriod("Retainer October 2026", oct, "QUARTERLY")).toBe("Retainer October 2026");
  });
});

describe("due dates", () => {
  it("parses payment terms", () => {
    expect(netDaysFromTerms("Net 30")).toBe(30);
    expect(netDaysFromTerms("net14")).toBe(14);
    expect(netDaysFromTerms("Due on receipt")).toBe(0);
    expect(netDaysFromTerms("Upon delivery")).toBe(0);
    expect(netDaysFromTerms("50% upfront, 50% on delivery")).toBeNull();
    expect(netDaysFromTerms(null)).toBeNull();
  });

  it("prefers the due date, then terms, then 30 days", () => {
    const issueDate = d("2026-10-01");
    expect(formatDateOnly(effectiveDueDate({ issueDate, dueDate: d("2026-10-10"), paymentTerms: "Net 30" }))).toBe("2026-10-10");
    expect(formatDateOnly(effectiveDueDate({ issueDate, dueDate: null, paymentTerms: "Net 14" }))).toBe("2026-10-15");
    expect(formatDateOnly(effectiveDueDate({ issueDate, dueDate: null, paymentTerms: null }))).toBe("2026-10-31");
  });
});

describe("nextPaidAt", () => {
  const today = d("2026-11-05");
  it("sets today when a document becomes PAID, and keeps the date while it stays PAID", () => {
    expect(nextPaidAt({ status: "ISSUED", paidAt: null }, "PAID", today)).toEqual(today);
    expect(nextPaidAt({ status: "PAID", paidAt: d("2026-10-01") }, "PAID", today)).toEqual(d("2026-10-01"));
    expect(nextPaidAt(null, "PAID", today)).toEqual(today);
  });
  it("takes a given date, and clears it for any other status", () => {
    expect(nextPaidAt({ status: "PAID", paidAt: d("2026-10-01") }, "PAID", today, d("2026-10-20"))).toEqual(d("2026-10-20"));
    expect(nextPaidAt({ status: "PAID", paidAt: d("2026-10-01") }, "ISSUED", today)).toBeNull();
    expect(nextPaidAt(null, "DRAFT", today)).toBeNull();
  });
});
