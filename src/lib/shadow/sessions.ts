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

/** Session a DecisionReview row written at `createdAt` was decided on, or null. */
export async function decisionSessionFor(createdAt: Date): Promise<string | null> {
  const sessions = await loadSessions();
  return decisionSessionFromEasternDate(sessions, easternDateOf(createdAt));
}
