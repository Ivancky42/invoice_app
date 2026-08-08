/**
 * Shadow branch bootstrap and NAV accounting.
 *
 * Each branch owns a completely independent PAPER book: its own cash, its own positions,
 * its own high-water mark. Nothing here reads the real book (no Portfolio, no Trade, no
 * Config cash) — the shadow ledger must stay uncontaminated by live accounting.
 */
import type { Branch } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { challengerLegitimacy } from "@/lib/rules/challenger";
import { decToNum } from "@/lib/stocks/format";
import { roundMoney } from "@/lib/shadow/fillMath";
import { sessionDate, ymd } from "@/lib/shadow/sessions";

/** Starting (and post-reset) paper NAV of every branch, in USD. */
export const SHADOW_INITIAL_NAV = 100_000;

export type ShadowBranchRow = {
  id: string;
  branch: Branch;
  ruleVersionId: number;
  cash: number;
  startNav: number;
  highWaterNav: number;
};

export type ShadowBookPosition = {
  id: string;
  ticker: string;
  shares: number;
  avgCost: number;
  /** Session close when the branch marked at this session, else the carried mark. */
  mark: number | null;
  markStale: boolean;
};

export type ShadowBook = {
  branchId: string;
  cash: number;
  nav: number;
  positions: ShadowBookPosition[];
  staleMarks: number;
};

function toDay(session: string | Date): string {
  return typeof session === "string" ? session : ymd(session);
}

function rowToBranch(row: {
  id: string;
  branch: Branch;
  ruleVersionId: number;
  cash: unknown;
  startNav: unknown;
  highWaterNav: unknown;
}): ShadowBranchRow {
  return {
    id: row.id,
    branch: row.branch,
    ruleVersionId: row.ruleVersionId,
    cash: decToNum(row.cash as never) ?? 0,
    startNav: decToNum(row.startNav as never) ?? 0,
    highWaterNav: decToNum(row.highWaterNav as never) ?? 0,
  };
}

/**
 * Seed the two paper books if they do not exist yet, and keep each branch's
 * `ruleVersionId` pointing at the version actually in force on it.
 *
 * `update: {}` on the upsert is on purpose — re-running must never clobber a live book's
 * cash, startNav or high-water mark. The ruleVersion pointer is then reconciled on its
 * own: a promotion that changed the ACTIVE version would otherwise leave LIVE's pointer
 * stale and mis-attribute that branch's fitness to the wrong ruleset. Only that one column
 * is written here; {@link resetBranch} (promotion / propose) is the other writer of it, and
 * it also restarts the book.
 *
 * The CANDIDATE pointer is only reconciled when its target is ILLEGITIMATE — see
 * {@link challengerLegitimacy}. A legitimate target (a status-CANDIDATE row, or the
 * immediately-deposed champion running the revert series) is never overwritten here.
 */
export async function ensureShadowBranches(): Promise<void> {
  const [active, candidatePointer] = await Promise.all([
    prisma.ruleVersion.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { id: "desc" },
      select: { id: true, parentId: true },
    }),
    prisma.shadowBranch.findUnique({
      where: { branch: "CANDIDATE" },
      select: { ruleVersionId: true },
    }),
  ]);

  // No ruleset at all → nothing to attribute a book to; seeding waits for one.
  const liveVersionId = active?.id ?? null;

  // The CANDIDATE pointer is the source of truth for "who the challenger is". A LEGITIMATE
  // target is left exactly where it is — recomputing it from status is what used to
  // overwrite the deposed champion (RETIRED, not CANDIDATE) back to ACTIVE on the next
  // tick and erase the revert series before it produced a single paired session.
  const pointerTarget = candidatePointer
    ? await prisma.ruleVersion.findUnique({
        where: { id: candidatePointer.ruleVersionId },
        select: { id: true, status: true },
      })
    : null;
  const legitimacy = challengerLegitimacy(pointerTarget, active);

  let candidateVersionId: number | null;
  if (legitimacy.ok) {
    candidateVersionId = candidatePointer!.ruleVersionId;
  } else {
    if (legitimacy.inconsistent) {
      console.error(
        "[shadow ensureShadowBranches] CANDIDATE pointer is illegitimate",
        `version ${candidatePointer?.ruleVersionId} (${legitimacy.reason})`,
        "— reconciling",
      );
    }
    const candidate = await prisma.ruleVersion.findFirst({
      where: { status: "CANDIDATE" },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    candidateVersionId = candidate?.id ?? active?.id ?? null;
  }

  const now = new Date();
  const seed = (branch: Branch, ruleVersionId: number) =>
    prisma.shadowBranch.upsert({
      where: { branch },
      create: {
        branch,
        ruleVersionId,
        startNav: SHADOW_INITIAL_NAV,
        cash: SHADOW_INITIAL_NAV,
        highWaterNav: SHADOW_INITIAL_NAV,
        resetAt: now,
      },
      update: {},
    });

  const seeds: Promise<unknown>[] = [];
  if (liveVersionId !== null) seeds.push(seed("LIVE", liveVersionId));
  if (candidateVersionId !== null) seeds.push(seed("CANDIDATE", candidateVersionId));
  await Promise.all(seeds);

  const targets: Array<[Branch, number]> = [];
  if (liveVersionId !== null) targets.push(["LIVE", liveVersionId]);
  if (candidateVersionId !== null) targets.push(["CANDIDATE", candidateVersionId]);
  await Promise.all(
    targets.map(async ([branch, ruleVersionId]) => {
      // Conditioned update: a no-op when the pointer is already correct, and it can never
      // touch cash / NAV / high-water mark.
      await prisma.shadowBranch.updateMany({
        where: { branch, ruleVersionId: { not: ruleVersionId } },
        data: { ruleVersionId },
      });
    }),
  );
}

export async function getBranch(branch: Branch): Promise<ShadowBranchRow | null> {
  const row = await prisma.shadowBranch.findUnique({ where: { branch } });
  return row ? rowToBranch(row) : null;
}

export async function listBranches(): Promise<ShadowBranchRow[]> {
  const rows = await prisma.shadowBranch.findMany({ orderBy: { branch: "asc" } });
  return rows.map(rowToBranch);
}

/**
 * The branch's book valued at `session`: cash + Σ open positions × that session's close,
 * falling back to the position's carried `lastMark` when the session has no bar.
 * One positions query + one PriceHistory query — never per-position lookups.
 */
export async function branchBook(
  branchId: string,
  session: string | Date,
): Promise<ShadowBook> {
  const day = toDay(session);
  const [branchRow, positions] = await Promise.all([
    prisma.shadowBranch.findUnique({ where: { id: branchId }, select: { cash: true } }),
    prisma.shadowPosition.findMany({
      where: { branchId, closedAt: null },
      select: {
        id: true,
        ticker: true,
        shares: true,
        avgCost: true,
        lastMark: true,
      },
    }),
  ]);

  const cash = decToNum(branchRow?.cash ?? null) ?? 0;
  const tickers = [...new Set(positions.map((p) => p.ticker))];
  const bars = tickers.length
    ? await prisma.priceHistory.findMany({
        where: { ticker: { in: tickers }, date: sessionDate(day) },
        select: { ticker: true, close: true },
      })
    : [];
  const closeByTicker = new Map(bars.map((b) => [b.ticker, decToNum(b.close)]));

  let equity = 0;
  let staleMarks = 0;
  const book: ShadowBookPosition[] = positions.map((p) => {
    const shares = decToNum(p.shares) ?? 0;
    const sessionClose = closeByTicker.get(p.ticker) ?? null;
    const carried = decToNum(p.lastMark);
    const mark = sessionClose ?? carried;
    const stale = sessionClose === null;
    if (stale) staleMarks += 1;
    if (mark !== null) equity += shares * mark;
    return {
      id: p.id,
      ticker: p.ticker,
      shares,
      avgCost: decToNum(p.avgCost) ?? 0,
      mark,
      markStale: stale,
    };
  });

  return {
    branchId,
    cash: roundMoney(cash),
    nav: roundMoney(cash + equity),
    positions: book,
    staleMarks,
  };
}

/** Branch NAV at `session` (cash + marked open positions). */
export async function branchNav(branchId: string, session: string | Date): Promise<number> {
  return (await branchBook(branchId, session)).nav;
}

/**
 * Close every open paper position and restart the book at {@link SHADOW_INITIAL_NAV}
 * under `ruleVersionId`. Used when a candidate is promoted — the new ruleset must not
 * inherit the previous one's positions or its high-water mark.
 */
export async function resetBranch(branch: Branch, ruleVersionId: number): Promise<void> {
  const row = await prisma.shadowBranch.findUnique({
    where: { branch },
    select: { id: true },
  });
  if (!row) return;

  const now = new Date();
  await prisma.$transaction([
    prisma.shadowPosition.updateMany({
      where: { branchId: row.id, closedAt: null },
      data: { closedAt: now, shares: 0, markStale: false },
    }),
    // Orders enqueued under the old ruleset must not fill into the new book.
    prisma.shadowOrder.updateMany({
      where: { branchId: row.id, status: "PENDING" },
      data: { status: "REJECTED", rejectReason: "branch_reset" },
    }),
    prisma.shadowBranch.update({
      where: { id: row.id },
      data: {
        ruleVersionId,
        startNav: SHADOW_INITIAL_NAV,
        cash: SHADOW_INITIAL_NAV,
        highWaterNav: SHADOW_INITIAL_NAV,
        resetAt: now,
      },
    }),
  ]);
}
