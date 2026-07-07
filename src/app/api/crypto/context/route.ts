import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorized } from "@/lib/cronAuth";
import { snapshotDateGMT8 } from "@/lib/stocks/portfolioTotals";
import { fetchFearGreed } from "@/lib/crypto/feargreed";
import {
  getCryptoAssets,
  getLatestSnapshots,
  getCatalysts,
  getBriefs,
  getLearnings,
} from "@/lib/crypto/db";
import { CryptoAssetStatus, CryptoLearningKind } from "@/generated/prisma/client";
import type { CryptoAsset, CryptoMetricSnapshot } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

/** Round to a fixed number of significant figures (prices ~4 sig figs). */
function sigFigs(n: number, figs = 4): number {
  if (!Number.isFinite(n) || n === 0) return 0;
  const d = Math.ceil(Math.log10(Math.abs(n)));
  const power = figs - d;
  const factor = Math.pow(10, power);
  return Math.round(n * factor) / factor;
}

/** Round a percentage to 1 decimal place. */
function pct1(n: number | null): number | null {
  return n == null ? null : Math.round(n * 10) / 10;
}

/** Compact per-asset entry for the context payload; omits null fields. */
type CompactAsset = Record<string, unknown>;

function compactAsset(a: CryptoAsset, s: CryptoMetricSnapshot | undefined): CompactAsset {
  const out: CompactAsset = { sym: a.symbol };
  const qty = a.quantity != null ? Number(a.quantity) : null;
  const avg = a.avgCost != null ? Number(a.avgCost) : null;
  if (qty != null) out.qty = qty;
  if (avg != null) out.avg = sigFigs(avg);
  if (s?.price != null) out.px = sigFigs(Number(s.price));
  if (s?.change24hPct != null) out.chg24 = pct1(Number(s.change24hPct));
  if (s?.change7dPct != null) out.chg7 = pct1(Number(s.change7dPct));
  if (s?.rsi14 != null) out.rsi = Math.round(Number(s.rsi14));
  if (s?.ma20 != null) out.ma20 = sigFigs(Number(s.ma20));
  if (s?.ma50 != null) out.ma50 = sigFigs(Number(s.ma50));
  if (s?.maCross) out.cross = s.maCross;
  if (s?.volumeSpike) out.volSpike = true;
  if (s?.fundingRate != null) out.fund = sigFigs(Number(s.fundingRate), 3);
  if (s?.beta30dBtc != null) out.beta = sigFigs(Number(s.beta30dBtc), 3);
  if (s?.tvlChange7dPct != null) out.tvl7 = pct1(Number(s.tvlChange7dPct));
  const flags = Array.isArray(s?.flags) ? (s.flags as string[]) : [];
  if (flags.length) out.flags = flags;
  if (a.thesis) out.thesis = a.thesis;
  if (a.keyCatalyst) out.cat = a.keyCatalyst;
  return out;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const scope = req.nextUrl.searchParams.get("scope");

  const [assets, snapshots, fearGreed, catalysts, briefs] = await Promise.all([
    getCryptoAssets(),
    getLatestSnapshots(),
    fetchFearGreed(),
    getCatalysts(2),
    getBriefs(2),
  ]);

  const portfolio: CompactAsset[] = [];
  const watchlist: CompactAsset[] = [];
  const trending: { sym: string; name: string; chg24: number | null }[] = [];

  for (const a of assets) {
    const s = snapshots.get(a.id);
    if (a.status === CryptoAssetStatus.PORTFOLIO) {
      portfolio.push(compactAsset(a, s));
    } else if (a.status === CryptoAssetStatus.WATCHLIST) {
      watchlist.push(compactAsset(a, s));
    } else if (a.status === CryptoAssetStatus.TRENDING) {
      trending.push({
        sym: a.symbol,
        name: a.name,
        chg24: s?.change24hPct != null ? pct1(Number(s.change24hPct)) : null,
      });
    }
  }

  const catalystsOut = catalysts.slice(0, 15).map((c) => ({
    t: c.title,
    s: Array.isArray(c.symbols) ? (c.symbols as string[]) : [],
    d: c.publishedAt ? c.publishedAt.toISOString().slice(0, 10) : null,
    src: c.source,
  }));

  // Latest brief = yesterday's calls to grade; prevDayMoves = its 24h snapshot moves.
  const latestBrief = briefs[0];
  const yesterdayBrief = latestBrief
    ? { summary: latestBrief.marketSummary, calls: latestBrief.calls }
    : null;

  const prevDayMoves = portfolio
    .concat(watchlist)
    .filter((a) => typeof a.chg24 === "number")
    .map((a) => ({ sym: a.sym as string, chg24: a.chg24 as number }));

  // heuristics: latest non-null heuristics across WEEKLY/MONTHLY logs.
  const [weeklyLogs, monthlyLogs] = await Promise.all([
    getLearnings(CryptoLearningKind.WEEKLY, 10),
    getLearnings(CryptoLearningKind.MONTHLY, 10),
  ]);
  const heuristicsLog = [...weeklyLogs, ...monthlyLogs]
    .filter((l) => l.heuristics)
    .sort((a, b) => b.logDate.getTime() - a.logDate.getTime())[0];
  const heuristics = heuristicsLog?.heuristics ?? null;

  // recentLearnings: last 3 DAILY summaries + evaluation lessons.
  const dailyLogs = await getLearnings(CryptoLearningKind.DAILY, 3);
  const recentLearnings = dailyLogs.map((l) => {
    const evals = Array.isArray(l.evaluations)
      ? (l.evaluations as { lesson?: string }[])
      : [];
    const lessons = evals.map((e) => e.lesson).filter((v): v is string => Boolean(v));
    return { summary: l.summary, lessons };
  });

  const payload: Record<string, unknown> = {
    date: snapshotDateGMT8().toISOString().slice(0, 10),
    fearGreed: fearGreed?.value ?? null,
    portfolio,
    watchlist,
    trending,
    catalysts: catalystsOut,
    yesterdayBrief,
    prevDayMoves,
    heuristics,
    recentLearnings,
  };

  if (scope === "weekly") {
    const recentDaily = await getLearnings(CryptoLearningKind.DAILY, 7);
    payload.dailyHistory = recentDaily.map((l) => ({
      date: l.logDate.toISOString().slice(0, 10),
      summary: l.summary,
      evaluations: l.evaluations ?? null,
    }));
  } else if (scope === "monthly") {
    const recentWeekly = await getLearnings(CryptoLearningKind.WEEKLY, 5);
    payload.weeklyHistory = recentWeekly.map((l) => ({
      date: l.logDate.toISOString().slice(0, 10),
      summary: l.summary,
      heuristics: l.heuristics,
    }));
  }

  return NextResponse.json(payload, { status: 200 });
}
