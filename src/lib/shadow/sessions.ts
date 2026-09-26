/**
 * Trading-session calendar for the shadow ledger.
 *
 * `PriceHistory` IS the calendar — there is no exchange-holiday table. A date counts as a
 * session when a quorum of anchor tickers (which the nightly universe force-includes)
 * stored a bar for it, so one flaky provider response cannot invent or erase a session.
 *
 * Reads PriceHistory only: no Portfolio / Trade / Config access lives in this module.
 */
import { prisma } from "@/lib/prisma";
import { easternSessionDate } from "@/lib/pricehistory/providers/finnhub";

/** Liquid names the nightly price-history universe always includes. */
export const SESSION_ANCHORS = ["SPY", "QQQ", "AAPL", "MSFT"] as const;

/** How many anchors must have a bar before a date counts as a session. */
export const SESSION_ANCHOR_QUORUM = 2;

/** Sessions older than this are never needed (3m horizon ≈ 63 sessions + slack). */
const CALENDAR_LOOKBACK_DAYS = 800;

/** In-process calendar cache; one PriceHistory scan per run rather than per query. */
const CACHE_TTL_MS = 60_000;
let cache: { at: number; sessions: string[] } | null = null;

export type AnchorBarRow = { ticker: string; date: Date };

/** UTC calendar date of a Date as YYYY-MM-DD (matches Prisma `@db.Date` storage). */
export function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** YYYY-MM-DD → the UTC-midnight Date Prisma writes into a `@db.Date` column. */
export function sessionDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * Pure: ascending session dates implied by anchor bars.
 * A date is a session when {@link SESSION_ANCHOR_QUORUM} distinct anchors have a bar.
 */
export function sessionDatesFromRows(rows: AnchorBarRow[]): string[] {
  const anchors = new Set<string>(SESSION_ANCHORS);
  const byDate = new Map<string, Set<string>>();
  for (const row of rows) {
    const ticker = row.ticker.trim().toUpperCase();
    if (!anchors.has(ticker)) continue;
    const day = ymd(row.date);
    const seen = byDate.get(day) ?? new Set<string>();
    seen.add(ticker);
    byDate.set(day, seen);
  }
  return [...byDate.entries()]
    .filter(([, seen]) => seen.size >= SESSION_ANCHOR_QUORUM)
    .map(([day]) => day)
    .sort();
}

/** Pure: index of the last session <= `day` in an ascending list, or -1. */
export function indexOnOrBefore(sessions: string[], day: string): number {
  let lo = 0;
  let hi = sessions.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sessions[mid]! <= day) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Pure: index of the first session > `day` in an ascending list, or -1. */
export function indexAfter(sessions: string[], day: string): number {
  const at = indexOnOrBefore(sessions, day);
  const next = at + 1;
  return next < sessions.length ? next : -1;
}

/** Pure: is `day` itself a session? */
export function isSessionIn(sessions: string[], day: string): boolean {
  const at = indexOnOrBefore(sessions, day);
  return at !== -1 && sessions[at] === day;
}

/** Pure: last session on or before `day`, or null. */
export function latestSessionOnOrBeforeIn(sessions: string[], day: string): string | null {
  const at = indexOnOrBefore(sessions, day);
  return at === -1 ? null : sessions[at]!;
}

/** Pure: first session strictly after `day`, or null. */
export function nextSessionAfterIn(sessions: string[], day: string): string | null {
  const at = indexAfter(sessions, day);
  return at === -1 ? null : sessions[at]!;
}

/** Pure: last session STRICTLY BEFORE `day`, or null. */
export function previousSessionBeforeIn(sessions: string[], day: string): string | null {
  const at = indexOnOrBefore(sessions, day);
  if (at === -1) return null;
  const prior = sessions[at] === day ? at - 1 : at;
  return prior >= 0 ? sessions[prior]! : null;
}

/** Pure: the `n`-th session after `from` (n >= 1), or null when history is short. */
export function sessionOffsetIn(sessions: string[], from: string, n: number): string | null {
  const at = indexOnOrBefore(sessions, from);
  if (at === -1 || sessions[at] !== from) return null;
  const target = at + n;
  return target < sessions.length ? sessions[target]! : null;
}

/**
 * Pure: the session a decision written at `createdAt` was made on.
 *
 * Routines run after the close, so the freshest bars the agent could have seen belong to
 * the latest session on or before the US-Eastern calendar date of `createdAt`. Using the
 * Eastern date matters: a 20:00 ET write is already the NEXT day in UTC, and a UTC-dated
 * lookup would credit the decision with a session that had not happened yet.
 */
export function decisionSessionFromEasternDate(
  sessions: string[],
  easternDate: string,
): string | null {
  return latestSessionOnOrBeforeIn(sessions, easternDate);
}

/** US-Eastern calendar date (YYYY-MM-DD) of an instant. */
export function easternDateOf(at: Date): string {
  return easternSessionDate(Math.floor(at.getTime() / 1000));
}

/** US regular-session close, in hours after Eastern midnight (16:00 ET). */
const US_CLOSE_HOUR_ET = 16;

/**
 * Eastern calendar date of the latest 16:00 ET close at or before `at`: the day itself
 * from the close onward, the day before until then. A write at 07:45 ET on the 25th has
 * only seen the 24th's close; {@link easternDateOf} would date it the 25th and baseline
 * it at a close eight hours in its future. Shifting by the close hour keeps the ET
 * calendar lookup (an hour off only on the two DST-switch nights, which are Sundays).
 */
export function easternCloseDateOf(at: Date): string {
  return easternDateOf(new Date(at.getTime() - US_CLOSE_HOUR_ET * 3_600_000));
}

export type DecisionAsOfInput = {
  /** Explicit decision calendar day when the DR carries one (Notion / agent). */
  decisionDate: Date | null;
  /** Row write time — fallback when `decisionDate` is null. */
  createdAt: Date;
};

function earlierOfStated(dr: DecisionAsOfInput, written: string): string {
  if (!dr.decisionDate) return written;
  const stated = ymd(dr.decisionDate);
  return stated < written ? stated : written;
}

/**
 * Calendar day a DecisionReview should be dated for session lookup.
 *
 * The EARLIER of the stated `decisionDate` and the last close the row could have seen
 * ({@link easternCloseDateOf} of `createdAt`). A decision cannot use bars from after it
 * was written, so the write time caps it: the routines run from Malaysia after the US
 * close and stamp the MYT calendar date, which is already the NEXT US day — trusting it
 * alone dated every paper decision one session late (fill a day late, counterfactual
 * baseline at a close the agent never saw). A run before the US close (a manual 19:45 MYT
 * run is 07:45 ET) caps at the PREVIOUS close for the same reason. A Notion backfill
 * keeps its older `decisionDate`. `decisionDate` is compared as a calendar string, never
 * run through {@link easternDateOf} (Notion stores midnight-UTC dates, which that would
 * shift back a day).
 */
export function decisionAsOfDay(dr: DecisionAsOfInput): string {
  return earlierOfStated(dr, easternCloseDateOf(dr.createdAt));
}

/**
 * Calendar day a DecisionReview was made on — {@link decisionAsOfDay} without the
 * close-time cap. Tenure floors compare this against the reset's calendar day: a decision
 * written after a mid-session reset belongs to the new tenure even though the last close
 * it saw predates the reset.
 */
export function decisionCalendarDay(dr: DecisionAsOfInput): string {
  return earlierOfStated(dr, easternDateOf(dr.createdAt));
}

/**
 * Pure: session a DecisionReview belongs to — the latest session on or before
 * {@link decisionAsOfDay}.
 */
export function decisionSessionForReview(
  sessions: string[],
  dr: DecisionAsOfInput,
): string | null {
  return decisionSessionFromEasternDate(sessions, decisionAsOfDay(dr));
}

/** Load (and cache) the ascending session calendar from PriceHistory anchors. */
export async function loadSessions(): Promise<string[]> {
  const hit = cache;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.sessions;

  const since = new Date(Date.now() - CALENDAR_LOOKBACK_DAYS * 86_400_000);
  const rows = await prisma.priceHistory.findMany({
    where: { ticker: { in: [...SESSION_ANCHORS] }, date: { gte: since } },
    select: { ticker: true, date: true },
  });
  const sessions = sessionDatesFromRows(rows);
  cache = { at: Date.now(), sessions };
  return sessions;
}

/** Drop the cached calendar (tests / after a price-history backfill). */
export function clearSessionCache(): void {
  cache = null;
}

export async function isSession(date: Date | string): Promise<boolean> {
  const sessions = await loadSessions();
  return isSessionIn(sessions, typeof date === "string" ? date : ymd(date));
}

export async function latestSessionOnOrBefore(date: Date | string): Promise<string | null> {
  const sessions = await loadSessions();
  return latestSessionOnOrBeforeIn(sessions, typeof date === "string" ? date : ymd(date));
}

export async function nextSessionAfter(date: Date | string): Promise<string | null> {
  const sessions = await loadSessions();
  return nextSessionAfterIn(sessions, typeof date === "string" ? date : ymd(date));
}

/**
 * Session a DecisionReview was decided on, or null.
 * Prefers `decisionDate` when provided; otherwise Eastern date of `createdAt`.
 */
export async function decisionSessionFor(
  createdAt: Date,
  decisionDate?: Date | null,
): Promise<string | null> {
  const sessions = await loadSessions();
  return decisionSessionForReview(sessions, {
    decisionDate: decisionDate ?? null,
    createdAt,
  });
}
