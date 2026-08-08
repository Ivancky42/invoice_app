/**
 * Real-book exposure for LIVE-branch counterfactual sizing.
 *
 * LIVE DecisionReviews are written about the real portfolio. Shadow paper weights are the
 * wrong denominator when the paper book never opened the name (BULL DNAD debited a phantom
 * 6% add while the real book was already over the Speculative band and near the single-name
 * cap). CANDIDATE seeds must not call this — that book is sized against its own paper only.
 *
 * Point-in-time caveat: Portfolio is current state, not a historical reconstruction. For
 * names that are still oversized today that is the conservative (zero-headroom) answer;
 * a full decision-day reconstruction would need per-day holdings history.
 */
import { prisma } from "@/lib/prisma";
import { decToNum } from "@/lib/stocks/format";
import {
  computePortfolioTotals,
  exCspxNavFromTotals,
  positionWeightPctExCspx,
} from "@/lib/stocks/portfolioTotals";

export type LiveBookExposure = {
  /** Fraction of ex-CSPX NAV per ticker. */
  weightByTicker: Map<string, number>;
  sleeveByTicker: Map<string, string>;
  /** Aggregate SPECULATIVE sleeve weight (fraction of ex-CSPX NAV). */
  speculativeSleeveWeight: number;
};

export async function loadLiveBookExposure(): Promise<LiveBookExposure> {
  const [portfolio, trades] = await Promise.all([
    prisma.portfolio.findMany(),
    prisma.trade.findMany(),
  ]);

  const totals = computePortfolioTotals(portfolio, trades);
  const exNav = exCspxNavFromTotals(totals);
  const weightByTicker = new Map<string, number>();
  const sleeveByTicker = new Map<string, string>();
  let speculativeSleeveWeight = 0;

  for (const p of portfolio) {
    const ticker = p.ticker.trim().toUpperCase();
    const shares = decToNum(p.shares) ?? 0;
    const px = decToNum(p.currentPrice);
    const marketValue = px !== null && shares > 0 ? shares * px : null;
    const weightPct = positionWeightPctExCspx(marketValue, ticker, exNav);
    if (weightPct === null) continue;
    const weight = weightPct / 100;
    weightByTicker.set(ticker, weight);
    if (p.sleeve) {
      sleeveByTicker.set(ticker, p.sleeve);
      if (p.sleeve === "SPECULATIVE") speculativeSleeveWeight += weight;
    }
  }

  return {
    weightByTicker,
    sleeveByTicker,
    speculativeSleeveWeight,
  };
}
