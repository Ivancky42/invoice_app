import { prisma } from "@/lib/prisma";
import { openPaperTickers } from "@/lib/shadow/read";
import { snapshotDateGMT8 } from "@/lib/stocks/portfolioTotals";

function parseYmdNoon(ymd: string): Date {
  return new Date(`${ymd}T12:00:00.000Z`);
}

/** Calendar YMD in Asia/Kuala_Lumpur (the paper daily's log date). */
export function paperPassAYmd(from = new Date()): string {
  return snapshotDateGMT8(from).toISOString().slice(0, 10);
}

export function passAIncompleteMessage(
  ymd: string,
  kind: "log" | "decision" = "log",
): string {
  const retry =
    kind === "decision"
      ? "then retry this CANDIDATE review"
      : "then retry this log";
  return `Pass A is missing: no LIVE PAPER decision reviews for ${ymd}. Write upsert_decision_review(branch="LIVE", book="PAPER") for the LIVE paper holdings first, ${retry}.`;
}

/**
 * True when the LIVE paper book has open names and none of them have a LIVE PAPER
 * DecisionReview for `ymd` (by decisionDate or createdAt on that UTC calendar day).
 * Empty LIVE paper book → false (nothing to review; do not block Pass B).
 */
export async function livePaperPassAMissing(ymd: string): Promise<boolean> {
  const liveOpen = await openPaperTickers("LIVE");
  if (liveOpen.size === 0) return false;

  const noon = parseYmdNoon(ymd);
  const dayStart = new Date(`${ymd}T00:00:00.000Z`);
  const nextDay = new Date(dayStart);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const passACount = await prisma.decisionReview.count({
    where: {
      branch: "LIVE",
      book: "PAPER",
      OR: [{ decisionDate: noon }, { createdAt: { gte: dayStart, lt: nextDay } }],
    },
  });
  return passACount === 0;
}
