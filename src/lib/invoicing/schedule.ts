/**
 * Pure date math for invoicing: recurring-schedule occurrences, due dates and the
 * business-timezone "today". No prisma here so it stays unit-testable.
 *
 * Date-only values (issue dates, schedule dates) are represented as a `Date` at UTC
 * midnight of that calendar day — the same shape Postgres `DATE` columns and
 * `new Date("YYYY-MM-DD")` produce, and how existing documents store `issueDate`.
 */

export type Frequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

/** Calendar the billing day is judged in. The daily cron fires ~06:00 here. */
export const DEFAULT_BILLING_TIMEZONE = "Asia/Kuala_Lumpur";

export function billingTimeZone(): string {
  return process.env.BILLING_TIMEZONE?.trim() || DEFAULT_BILLING_TIMEZONE;
}

/** Fallback when an invoice has neither a due date nor parseable payment terms. */
export const DEFAULT_NET_DAYS = 30;

/** A quotation without its own date is valid this many days from issue. */
export const QUOTE_VALID_DAYS = 30;

const DAY_MS = 86_400_000;

export function dateOnly(year: number, month0: number, day: number): Date {
  return new Date(Date.UTC(year, month0, day));
}

/** Normalize any Date to UTC midnight of its UTC calendar day. */
export function toDateOnly(d: Date): Date {
  return dateOnly(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `YYYY-MM-DD` (or an ISO datetime, truncated to its date). Throws on garbage. */
export function parseDateOnly(raw: string): Date {
  const s = raw.trim().slice(0, 10);
  const m = ISO_DATE.exec(s);
  if (!m) throw new Error(`Invalid date "${raw}" — expected YYYY-MM-DD`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const out = dateOnly(y, mo, d);
  if (out.getUTCFullYear() !== y || out.getUTCMonth() !== mo || out.getUTCDate() !== d) {
    throw new Error(`Invalid date "${raw}"`);
  }
  return out;
}

export function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, days: number): Date {
  return new Date(toDateOnly(d).getTime() + days * DAY_MS);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((toDateOnly(to).getTime() - toDateOnly(from).getTime()) / DAY_MS);
}

/** The calendar date it currently is in `timeZone`, as a date-only value. */
export function todayInTimeZone(now: Date = new Date(), timeZone = billingTimeZone()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parseDateOnly(parts);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

const MONTHS_PER_STEP: Record<Exclude<Frequency, "WEEKLY">, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
};

export type ScheduleShape = {
  frequency: Frequency;
  interval: number;
  /** 1–31, clamped to the month's last day. Null → the start date's day. Ignored for WEEKLY. */
  dayOfMonth: number | null;
  startDate: Date;
  endDate?: Date | null;
  maxOccurrences?: number | null;
};

function stepMonths(s: ScheduleShape): number {
  if (s.frequency === "WEEKLY") return 0;
  return MONTHS_PER_STEP[s.frequency] * Math.max(1, s.interval);
}

/**
 * The k-th slot of the schedule's grid (k ≥ 0), computed from the anchor every time so
 * month-end clamping never drifts (31 Jan → 28 Feb → 31 Mar, not → 28 Mar).
 * Slot 0 can fall before `startDate` when `dayOfMonth` is earlier in the month than the
 * start date; {@link nextOccurrenceOnOrAfter} skips such slots.
 */
export function gridDate(s: ScheduleShape, k: number): Date {
  const start = toDateOnly(s.startDate);
  if (s.frequency === "WEEKLY") {
    return addDays(start, 7 * Math.max(1, s.interval) * k);
  }
  const totalMonths = start.getUTCMonth() + stepMonths(s) * k;
  const year = start.getUTCFullYear() + Math.floor(totalMonths / 12);
  const month0 = ((totalMonths % 12) + 12) % 12;
  const wanted = s.dayOfMonth ?? start.getUTCDate();
  return dateOnly(year, month0, Math.min(Math.max(1, wanted), daysInMonth(year, month0)));
}

/** First scheduled date on or after `date` (and never before `startDate`). Ignores end limits. */
export function nextOccurrenceOnOrAfter(s: ScheduleShape, date: Date): Date {
  const start = toDateOnly(s.startDate);
  const target = toDateOnly(date) < start ? start : toDateOnly(date);
  // Estimate the slot index, back off one, then walk forward — at most a few steps.
  let k: number;
  if (s.frequency === "WEEKLY") {
    k = Math.floor(daysBetween(start, target) / (7 * Math.max(1, s.interval)));
  } else {
    const monthsApart =
      (target.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (target.getUTCMonth() - start.getUTCMonth());
    k = Math.floor(monthsApart / stepMonths(s));
  }
  k = Math.max(0, k - 1);
  for (;;) {
    const d = gridDate(s, k);
    if (d >= target) return d;
    k++;
  }
}

/** First scheduled date strictly after `date`. */
export function nextOccurrenceAfter(s: ScheduleShape, date: Date): Date {
  return nextOccurrenceOnOrAfter(s, addDays(date, 1));
}

/** True when an invoice dated `date` would be past the schedule's end (date or count). */
export function isBeyondEnd(s: ScheduleShape, date: Date, alreadyGenerated: number): boolean {
  if (s.endDate && toDateOnly(date) > toDateOnly(s.endDate)) return true;
  if (s.maxOccurrences != null && alreadyGenerated >= s.maxOccurrences) return true;
  return false;
}

/** Up to `count` upcoming dates from `from` (inclusive), respecting end date / max count. */
export function previewOccurrences(
  s: ScheduleShape,
  from: Date,
  alreadyGenerated: number,
  count: number,
): Date[] {
  const out: Date[] = [];
  let d = nextOccurrenceOnOrAfter(s, from);
  let n = alreadyGenerated;
  while (out.length < count && !isBeyondEnd(s, d, n)) {
    out.push(d);
    n++;
    d = nextOccurrenceAfter(s, d);
  }
  return out;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

/** Human label for the period an invoice dated `date` bills for. */
export function periodLabel(frequency: Frequency, interval: number, date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  if (frequency === "WEEKLY") {
    return `week of ${date.getUTCDate()} ${MONTH_SHORT[m]} ${y}`;
  }
  if (frequency === "YEARLY" && interval <= 1) return String(y);
  const span = (frequency === "MONTHLY" ? 1 : frequency === "QUARTERLY" ? 3 : 12) * Math.max(1, interval);
  if (span === 1) return `${MONTH_NAMES[m]} ${y}`;
  const endTotal = m + span - 1;
  const ey = y + Math.floor(endTotal / 12);
  const em = endTotal % 12;
  return `${MONTH_SHORT[m]} ${y} – ${MONTH_SHORT[em]} ${ey}`;
}

export type TemplateContext = {
  frequency: Frequency;
  interval: number;
  date: Date;
  /** 1-based number of this invoice in the series. */
  n: number;
  /** Total invoices in the series, or null when indefinite. */
  of: number | null;
};

/**
 * Fill `{{period}}`, `{{month}}`, `{{year}}`, `{{date}}`, `{{n}}`, `{{of}}` in template
 * text. Unknown placeholders are left as written.
 */
export function renderTemplate(text: string, ctx: TemplateContext): string {
  const values: Record<string, string> = {
    period: periodLabel(ctx.frequency, ctx.interval, ctx.date),
    month: MONTH_NAMES[ctx.date.getUTCMonth()],
    year: String(ctx.date.getUTCFullYear()),
    date: formatDateOnly(ctx.date),
    n: String(ctx.n),
    of: ctx.of == null ? "∞" : String(ctx.of),
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole,
  );
}

/**
 * Make a one-off invoice's text reusable: the source invoice's own month ("October 2026",
 * "Oct 2026") becomes `{{period}}`, so a schedule built from it doesn't keep billing
 * October. Only monthly cadences, and only that exact month and year, are rewritten.
 */
export function templatizePeriod(text: string, issueDate: Date, frequency: Frequency = "MONTHLY"): string {
  if (frequency !== "MONTHLY") return text;
  const m = issueDate.getUTCMonth();
  const y = issueDate.getUTCFullYear();
  const re = new RegExp(`\\b(?:${MONTH_NAMES[m]}|${MONTH_SHORT[m]}\\.?)\\s+${y}\\b`, "gi");
  return text.replace(re, "{{period}}");
}

/**
 * Days until due implied by payment terms: "Net 30" → 30, "Due on receipt" /
 * "Upon delivery" / "Immediate" → 0, anything else → null.
 */
export function netDaysFromTerms(terms: string | null | undefined): number | null {
  if (!terms) return null;
  const net = /\bnet\s*(\d{1,3})\b/i.exec(terms);
  if (net) return Number(net[1]);
  if (/\b(receipt|upon|immediate|immediately|cod)\b/i.test(terms)) return 0;
  return null;
}

/**
 * When an invoice is actually due: its due date, else issue date + Net-N terms, else
 * issue date + {@link DEFAULT_NET_DAYS}. The billing dashboard's SQL mirrors this.
 */
export function effectiveDueDate(doc: {
  issueDate: Date;
  dueDate: Date | null;
  paymentTerms: string | null;
}): Date {
  if (doc.dueDate) return toDateOnly(doc.dueDate);
  return addDays(doc.issueDate, netDaysFromTerms(doc.paymentTerms) ?? DEFAULT_NET_DAYS);
}

/** Last day a quotation can be accepted: its due date, else issue date + {@link QUOTE_VALID_DAYS}. */
export function quoteValidUntil(doc: { issueDate: Date; dueDate: Date | null }): Date {
  return doc.dueDate ? toDateOnly(doc.dueDate) : addDays(doc.issueDate, QUOTE_VALID_DAYS);
}
