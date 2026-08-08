/**
 * `shadow_mark`: nightly mark-to-market of every open paper position from PriceHistory.
 *
 * A position without a bar for the session keeps its previous mark and is flagged
 * `markStale` — a NAV built on carried marks is not the same evidence as a fully marked
 * one, and the stale ratio is what a later fitness job discounts on.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { JobContext, JobResult } from "@/lib/cron/jobs";
import { prisma } from "@/lib/prisma";
import { branchBook, ensureShadowBranches, listBranches } from "@/lib/shadow/branches";
import { roundMoney } from "@/lib/shadow/fillMath";
import { latestSessionOnOrBeforeIn, loadSessions, sessionDate, ymd } from "@/lib/shadow/sessions";
import { decToNum } from "@/lib/stocks/format";

export type ShadowMarkBranchDetail = {
  nav: number;
  cash: number;
  openPositions: number;
  staleMarks: number;
};

export type ShadowMarkDetail = {
  session: string | null;
  byBranch: Record<string, ShadowMarkBranchDetail>;
};

export async function runShadowMark(ctx: JobContext): Promise<JobResult> {
  await ensureShadowBranches();
  const [branches, sessions] = await Promise.all([listBranches(), loadSessions()]);
  const sessionDay = latestSessionOnOrBeforeIn(sessions, ymd(ctx.runDay));

  const detail: ShadowMarkDetail = { session: sessionDay, byBranch: {} };
  if (!sessionDay) return { done: true, detail: detail as unknown as Prisma.InputJsonValue };

  const markSession = sessionDate(sessionDay);

  for (const branchRow of branches) {
    const positions = await prisma.shadowPosition.findMany({
      where: { branchId: branchRow.id, closedAt: null },
      select: { id: true, ticker: true },
    });

    if (positions.length > 0) {
      const bars = await prisma.priceHistory.findMany({
        where: {
          ticker: { in: [...new Set(positions.map((p) => p.ticker))] },
          date: markSession,
        },
        select: { ticker: true, close: true },
      });
      const closeByTicker = new Map(bars.map((b) => [b.ticker, decToNum(b.close)]));

      const staleIds: string[] = [];
      for (const position of positions) {
        const close = closeByTicker.get(position.ticker) ?? null;
        if (close === null) {
          // Carry the previous mark forward — never substitute another session's price.
          staleIds.push(position.id);
          continue;
        }
        // One update per position: each carries its own close.
        await prisma.shadowPosition.update({
          where: { id: position.id },
          data: {
            lastMark: close,
            lastMarkSession: markSession,
            markStale: false,
          },
        });
      }
      if (staleIds.length > 0) {
        await prisma.shadowPosition.updateMany({
          where: { id: { in: staleIds } },
          data: { markStale: true },
        });
      }
    }

    const book = await branchBook(branchRow.id, sessionDay);
    const highWaterNav = roundMoney(Math.max(branchRow.highWaterNav, book.nav));
    if (highWaterNav > branchRow.highWaterNav) {
      await prisma.shadowBranch.update({
        where: { id: branchRow.id },
        data: { highWaterNav },
      });
    }

    detail.byBranch[branchRow.branch] = {
      nav: book.nav,
      cash: book.cash,
      openPositions: book.positions.length,
      staleMarks: book.staleMarks,
    };
  }

  return { done: true, detail: detail as unknown as Prisma.InputJsonValue };
}
